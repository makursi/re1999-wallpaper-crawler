import type { DiscoveryStats, DownloadOutcome, RunMeta, RunReport } from './report/report.js'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import {
  BASE_ORIGIN,
  BATCH_SIZE,
  GALLERY_STATE_FILE,
  IMAGES_DIR,
  LOG_DIR,
  PAGE_HASH,
  PAGE_PATH,
  PAGE_URL,
  PLAYWRIGHT_CONFIG,
  PROJECT_ROOT,
  SESSION,
  USER_AGENT,
} from './config.js'
import { buildRunCodeScript } from './discovery/discovery-loader.js'
import { downloadBatch, extractCookies } from './download/download.js'
import { createLogger } from './logger.js'
import {
  countWallpapers,
  isWallpaperFile,
  mergeGalleryStats,
  readGalleryStats,
  writeGalleryStats,
} from './report/gallery.js'
import { buildRunReport, classifyOutcomes, detectLeaks } from './report/report.js'
import { classifySiteAsset, describeSiteAssetRules, splitWallpaperUrls } from './wallpaper-url.js'

// ── Playwright CLI wrapper ─────────────────────────────────────────

function pwc(args: string, timeoutSec = 300): string {
  return execSync(`npx playwright-cli -s=${SESSION} ${args}`, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: timeoutSec * 1000,
    maxBuffer: 50 * 1024 * 1024,
  })
}

// ── helpers ────────────────────────────────────────────────────────

function newRunMeta(): { meta: RunMeta, config: Record<string, string | number | boolean | undefined> } {
  const startedAt = new Date().toISOString()
  const runId = startedAt.replace(/[:.]/g, '-').slice(0, 19)
  return {
    meta: { runId, startedAt, config: {} },
    config: {
      BASE_ORIGIN,
      PAGE_PATH,
      PAGE_HASH,
      IMAGES_DIR,
      LOG_DIR,
      SESSION,
      BATCH_SIZE,
      PLAYWRIGHT_CONFIG,
      USER_AGENT,
      GALLERY_STATE_FILE,
      SITE_ASSET_FILTER: describeSiteAssetRules(),
    },
  }
}

// execSync throws an Error; anything else reaching a catch is unknown and only
// has a useful String() form.
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// An object is indexable at runtime; this is the narrowing the browser-payload
// checks need, without an assertion that would skip the checks themselves.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// run-code publishes its diagnostics as `{ t, msg }` records in `window.__wpLog`.
function isRunCodeLogEntry(value: unknown): value is { msg: string } {
  return isRecord(value)
    && 'msg' in value
    && typeof value.msg === 'string'
}

// `playwright-cli --raw eval "JSON.stringify(...)"` sometimes hands back a JSON
// *string* that still has to be decoded, so decode until it is not a string.
function parseJsonPayload(raw: string): unknown {
  const first: unknown = JSON.parse(raw)
  return typeof first === 'string' ? JSON.parse(first) : first
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

// `window.__wpStats` is the browser's word on how discovery went, so every field
// is checked here: a truncated or stale payload must not put junk into the Run
// report's discovery block (its `converged`/counts drive defect detection).
function parseStats(rawStats: string): DiscoveryStats {
  const fallback: DiscoveryStats = {
    converged: false,
    stableRounds: 0,
    totalIdleSec: 0,
    networkCount: 0,
    domCount: 0,
    combinedCount: 0,
    thumbnailsClicked: 0,
    discoveryDurationMs: 0,
  }
  if (!rawStats)
    return fallback
  try {
    const parsed = parseJsonPayload(rawStats)
    if (!isRecord(parsed))
      return fallback
    return {
      converged: booleanOr(parsed.converged, fallback.converged),
      stableRounds: numberOr(parsed.stableRounds, fallback.stableRounds),
      totalIdleSec: numberOr(parsed.totalIdleSec, fallback.totalIdleSec),
      networkCount: numberOr(parsed.networkCount, fallback.networkCount),
      domCount: numberOr(parsed.domCount, fallback.domCount),
      combinedCount: numberOr(parsed.combinedCount, fallback.combinedCount),
      thumbnailsClicked: numberOr(parsed.thumbnailsClicked, fallback.thumbnailsClicked),
      discoveryDurationMs: numberOr(parsed.discoveryDurationMs, fallback.discoveryDurationMs),
    }
  }
  catch {
    return fallback
  }
}

function printSummary(logger: ReturnType<typeof createLogger>, report: RunReport): void {
  const m = report.download
  const g = report.gallery

  logger.info('========================================')
  logger.info('           DOWNLOAD SUMMARY')
  logger.info('========================================')
  logger.info(`  Images captured    : ${report.discovery.combinedCount}  (Site assets filtered: ${report.siteAssets.count})`)
  logger.info(`  Wallpapers found   : ${m.total}`)
  logger.info(`  Successfully saved : ${m.ok}`)
  logger.info(`  Skipped (existing) : ${m.skipped}`)
  logger.info(`  Failed             : ${m.failed}`)

  if (m.failures.length > 0) {
    logger.info('  Failed URLs:')
    for (const f of m.failures) {
      logger.info(`    - ${f.url}`)
      logger.info(`      Reason: ${f.reason}`)
    }
  }

  if (fs.existsSync(IMAGES_DIR)) {
    const totalSize = fs
      .readdirSync(IMAGES_DIR)
      .filter(isWallpaperFile)
      .reduce((s, f) => s + fs.statSync(path.join(IMAGES_DIR, f)).size, 0)
    const mb = (totalSize / 1024 / 1024).toFixed(1)
    logger.info(`  Total size on disk  : ${mb} MB`)
  }

  logger.info('========================================')
  logger.info('           GALLERY TOTAL')
  logger.info('========================================')
  const delta = g.newSinceLastRun > 0 ? `+${g.newSinceLastRun}` : '+0'
  if (g.firstRun)
    logger.info(`  Official wallpapers : ${g.officialTotal}  (first record, ${delta} this run)`)
  else
    logger.info(`  Official wallpapers : ${g.officialTotal}  (previous ${g.previousOfficialTotal}, ${delta})`)
  logger.info('========================================')
}

/**
 * Refresh the cross-run gallery total: count the Wallpapers on disk, compare
 * with the previous Run's record, and persist. A failure to persist must not
 * cost the Run its report, so it only warns.
 */
function updateGalleryStats(
  logger: ReturnType<typeof createLogger>,
  meta: RunMeta,
  at: string,
  newThisRun: number,
): ReturnType<typeof mergeGalleryStats> {
  const files = fs.existsSync(IMAGES_DIR) ? fs.readdirSync(IMAGES_DIR) : []
  const stats = mergeGalleryStats(
    readGalleryStats(GALLERY_STATE_FILE),
    countWallpapers(files),
    newThisRun,
    meta.runId,
    at,
  )
  try {
    writeGalleryStats(GALLERY_STATE_FILE, stats)
  }
  catch (err: unknown) {
    logger.warn({ err: errorMessage(err) }, 'failed to persist gallery state')
  }
  return stats
}

function finishRun(
  logger: ReturnType<typeof createLogger>,
  meta: RunMeta,
  discoveryStats: DiscoveryStats,
  outcomes: DownloadOutcome[],
  leakedUrls: string[],
  siteAssets: string[],
): RunReport {
  const finishedAt = new Date().toISOString()
  const metrics = classifyOutcomes(outcomes)
  const gallery = updateGalleryStats(logger, meta, finishedAt, metrics.ok)
  const report = buildRunReport(meta, finishedAt, {
    discovery: discoveryStats,
    metrics,
    gallery,
    leakedUrls,
    siteAssets,
  })

  logger.info(report, 'run report')

  const d = report.defects
  if (d.discoveryLeak.count > 0)
    logger.warn({ defect: 'discoveryLeak', count: d.discoveryLeak.count, urls: d.discoveryLeak.urls }, 'leaked URLs detected')
  if (d.nonConverged)
    logger.warn({ defect: 'nonConverged', stableRounds: report.discovery.stableRounds }, 'discovery did not converge')
  if (d.emptyResult)
    logger.warn({ defect: 'emptyResult' }, 'no images found — page structure may have changed')
  if (d.persistentFailures > 0)
    logger.warn({ defect: 'persistentFailures', count: d.persistentFailures }, 'downloads failed even after retry')
  if (d.emptyFiles.length > 0)
    logger.warn({ defect: 'emptyFiles', files: d.emptyFiles }, 'downloaded files were empty (0 bytes)')

  return report
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  const logger = createLogger(LOG_DIR)
  const { meta, config } = newRunMeta()
  logger.info({ type: 'run_meta', runId: meta.runId, startedAt: meta.startedAt, config }, 'run started')

  // 0. Clean slate
  logger.info('0. Preparing fresh browser session...')
  try {
    pwc('close-all', 10)
  }
  catch {}
  try {
    pwc('delete-data', 10)
  }
  catch {}
  logger.info('   Session cleared.')

  // 1. Open browser with real Chrome, 2560x1440 window, persistent
  logger.info('1. Opening browser...')
  const configPath = path.resolve(PROJECT_ROOT, PLAYWRIGHT_CONFIG)
  pwc(`open --persistent --config=${configPath}`)

  // Navigate to the page and wait for it to load
  logger.info('1b. Navigating to wallpaper page...')
  pwc(`goto ${PAGE_URL}`)
  try {
    pwc('wait-for load', 30)
  }
  catch {}

  // 2. Run comprehensive image discovery script
  logger.info('2. Running image discovery (scroll + thumbnails)...')
  logger.info('   (this may take several minutes)')

  // Write run-code script to temp file, load via --filename.
  // This avoids Windows cmd.exe escaping issues with multi-line strings and # hashes.
  const runScript = buildRunCodeScript()
  const scriptFile = path.resolve(PROJECT_ROOT, '__run_script.js')
  fs.writeFileSync(scriptFile, runScript, 'utf8')

  try {
    execSync(
      `npx playwright-cli -s=${SESSION} run-code --filename="${scriptFile}"`,
      {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 900_000, // slow networks: discovery can take >10min (425s observed)
        maxBuffer: 50 * 1024 * 1024,
      },
    )
  }
  catch (err: unknown) {
    logger.error({ err: errorMessage(err) }, 'run-code execution failed')
  }
  try {
    fs.unlinkSync(scriptFile)
  }
  catch {}

  // 3. Extract URLs from browser (merged network + DOM from run-code)
  logger.info('3. Extracting image URLs from browser...')

  const rawJson = execSync(
    `npx playwright-cli -s=${SESSION} --raw eval "JSON.stringify(window.__wpUrls || [])"`,
    {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30_000,
      maxBuffer: 50 * 1024 * 1024,
    },
  ).trim()

  let allUrls: string[]
  try {
    const parsed = parseJsonPayload(rawJson)
    const captured: unknown[] = Array.isArray(parsed) ? parsed : []
    allUrls = captured.filter((url): url is string => typeof url === 'string')
  }
  catch {
    logger.error('Failed to parse URLs from browser.')
    allUrls = []
  }
  logger.info(`   Total unique images: ${allUrls.length}`)

  const leakedUrls = detectLeaks(allUrls)
  if (leakedUrls.length > 0) {
    logger.warn(`   Leaked non-image URLs: ${leakedUrls.length}`)
    for (const u of leakedUrls)
      logger.warn(`     - ${u}`)
  }

  // 3a. Drop Site assets — the page HTML, analytics pixels, site UI art — so
  // they never reach Download. The raw capture above is left untouched for the
  // leak check, and the drop is recorded in the report.
  const { wallpapers, siteAssets } = splitWallpaperUrls(allUrls)
  if (siteAssets.length > 0) {
    logger.info(`   Site assets filtered: ${siteAssets.length}`)
    for (const u of siteAssets) {
      const rule = classifySiteAsset(u)
      logger.info(`     - ${u}  [${rule?.reason ?? 'unknown'}]`)
    }
  }
  logger.info(`   Wallpapers to download: ${wallpapers.length}`)

  // 3b. Extract run-code diagnostic log
  try {
    const rawLog = execSync(
      `npx playwright-cli -s=${SESSION} --raw eval "JSON.stringify(window.__wpLog || [])"`,
      {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 15_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    ).trim()
    const parsed = parseJsonPayload(rawLog)
    const entries: unknown[] = Array.isArray(parsed) ? parsed : []
    for (const entry of entries) {
      if (isRunCodeLogEntry(entry))
        logger.info({ phase: 'run-code' }, entry.msg)
    }
  }
  catch {
    logger.warn('Failed to extract run-code diagnostic log.')
  }

  // 3c. Extract structured discovery stats
  let discoveryStats: DiscoveryStats
  try {
    const rawStats = execSync(
      `npx playwright-cli -s=${SESSION} --raw eval "JSON.stringify(window.__wpStats || {})"`,
      {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 15_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    ).trim()
    discoveryStats = parseStats(rawStats)
  }
  catch {
    logger.warn('Failed to extract discovery stats.')
    discoveryStats = parseStats('')
  }

  if (wallpapers.length === 0) {
    logger.warn('No Wallpapers found. The page structure may have changed.')
    printSummary(logger, finishRun(logger, meta, discoveryStats, [], leakedUrls, siteAssets))
    return
  }

  // 4. Extract cookies for download
  logger.info('4. Extracting cookies...')
  extractCookies(pwc)

  // 5. Download all images
  logger.info('5. Downloading images...')
  fs.mkdirSync(IMAGES_DIR, { recursive: true })

  const outcomes = await downloadBatch(wallpapers, IMAGES_DIR, BATCH_SIZE, logger)

  // 6. Summarize, report and print
  printSummary(logger, finishRun(logger, meta, discoveryStats, outcomes, leakedUrls, siteAssets))
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
