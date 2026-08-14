import type { DiscoveryStats, DownloadMetrics, DownloadOutcome, RunMeta } from './report'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import {
  BASE_ORIGIN,
  BATCH_SIZE,
  IMAGES_DIR,
  LOG_DIR,
  PAGE_HASH,
  PAGE_PATH,
  PAGE_URL,
  PLAYWRIGHT_CONFIG,
  SESSION,
  USER_AGENT,
} from './config'
import { downloadBatch, extractCookies } from './download'
import { createLogger } from './logger'
import { buildRunReport, classifyOutcomes, detectLeaks } from './report'
import { buildRunCodeScript } from './scraper'

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
    },
  }
}

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
    const first: unknown = JSON.parse(rawStats)
    const parsed: unknown = typeof first === 'string' ? JSON.parse(first) : first
    if (typeof parsed !== 'object' || parsed === null)
      return fallback
    return { ...fallback, ...(parsed as Partial<DiscoveryStats>) }
  }
  catch {
    return fallback
  }
}

function printSummary(logger: ReturnType<typeof createLogger>, m: DownloadMetrics): void {
  logger.info('========================================')
  logger.info('           DOWNLOAD SUMMARY')
  logger.info('========================================')
  logger.info(`  Total images found : ${m.total}`)
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
      .filter(f => /\.(?:png|jpe?g|webp|gif)$/i.test(f))
      .reduce((s, f) => s + fs.statSync(path.join(IMAGES_DIR, f)).size, 0)
    const mb = (totalSize / 1024 / 1024).toFixed(1)
    logger.info(`  Total size on disk  : ${mb} MB`)
  }
  logger.info('========================================')
}

function finishRun(
  logger: ReturnType<typeof createLogger>,
  meta: RunMeta,
  discoveryStats: DiscoveryStats,
  outcomes: DownloadOutcome[],
  leakedUrls: string[],
): void {
  const finishedAt = new Date().toISOString()
  const metrics = classifyOutcomes(outcomes)
  const report = buildRunReport(meta, finishedAt, discoveryStats, metrics, leakedUrls)

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
  const configPath = path.resolve(__dirname, '..', PLAYWRIGHT_CONFIG)
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
  const scriptFile = path.resolve(__dirname, '..', '__run_script.js')
  fs.writeFileSync(scriptFile, runScript, 'utf8')

  try {
    execSync(
      `npx playwright-cli -s=${SESSION} run-code --filename="${scriptFile}"`,
      {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 600_000,
        maxBuffer: 50 * 1024 * 1024,
      },
    )
  }
  catch (err: unknown) {
    const execErr = err as { message?: string, stdout?: string, stderr?: string }
    logger.error({ err: execErr.message }, 'run-code execution failed')
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
    const first: unknown = JSON.parse(rawJson)
    allUrls
      = typeof first === 'string'
        ? (JSON.parse(first) as string[])
        : (first as string[])
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
    const logEntries: unknown = JSON.parse(rawLog)
    const entries = (
      Array.isArray(logEntries)
        ? logEntries
        : typeof logEntries === 'string'
          ? JSON.parse(logEntries)
          : []
    ) as Array<{ t: number, msg: string }>
    for (const entry of entries)
      logger.info({ phase: 'run-code' }, entry.msg)
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

  if (allUrls.length === 0) {
    logger.warn('No images found. The page structure may have changed.')
    finishRun(logger, meta, discoveryStats, [], leakedUrls)
    printSummary(logger, classifyOutcomes([]))
    return
  }

  // 4. Extract cookies for download
  logger.info('4. Extracting cookies...')
  extractCookies(pwc)

  // 5. Download all images
  logger.info('5. Downloading images...')
  fs.mkdirSync(IMAGES_DIR, { recursive: true })

  const outcomes = await downloadBatch(allUrls, IMAGES_DIR, BATCH_SIZE, logger)

  // 6. Summarize, report and print
  const metrics = classifyOutcomes(outcomes)
  finishRun(logger, meta, discoveryStats, outcomes, leakedUrls)
  printSummary(logger, metrics)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
