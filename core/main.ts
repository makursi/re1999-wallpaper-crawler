import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

import {
  APP_ROOT,
  BASE_ORIGIN,
  BATCH_SIZE,
  DATA_ROOT,
  GALLERY_LIST_URL,
  GALLERY_STATE_FILE,
  IMAGES_DIR,
  IMAGES_DIR_SETTING,
  LOG_DIR,
  LOG_DIR_SETTING,
  USER_AGENT,
  USER_CONFIG_NOTICE,
} from './config.js'
import { ensureDataLayout } from './data-layout.js'
import type { DiscoveryResult } from './discovery/discovery.js'
import { discoverFromList } from './discovery/discovery.js'
import { downloadBatch } from './download/download.js'
import type { GalleryList } from './gallery/gallery-source.js'
import { fetchGalleryList } from './gallery/gallery-source.js'
import type { GalleryStats } from './gallery/gallery-state.js'
import {
  mergeGalleryStats,
  readGalleryState,
  unavailableGalleryStats,
  writeGalleryState,
} from './gallery/gallery-state.js'
import { createLogger } from './logger.js'
import type { DownloadOutcome, RunMeta, RunReport } from './report/report.js'
import { buildRunReport, classifyOutcomes } from './report/report.js'
import { isWallpaperFile } from './wallpaper-url.js'

// ── helpers ────────────────────────────────────────────────────────

function newRunMeta(): {
  meta: RunMeta
  config: Record<string, string | number | boolean | undefined>
} {
  const startedAt = new Date().toISOString()
  const runId = startedAt.replace(/[:.]/g, '-').slice(0, 19)
  return {
    meta: { runId, startedAt, config: {} },
    config: {
      BASE_ORIGIN,
      IMAGES_DIR,
      LOG_DIR,
      BATCH_SIZE,
      USER_AGENT,
      GALLERY_LIST_URL,
      GALLERY_STATE_FILE,
    },
  }
}

// Anything reaching a catch is unknown and only has a useful String() form.
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Ask the site's own gallery list. It is not a check on a capture any more — it
 * is the Run's Discovery (#76): without it there is nothing to download, and the
 * report says so (`gallerySourceUnavailable`, `coverage: null`) instead of
 * guessing at a URL set.
 */
async function loadGalleryList(
  logger: ReturnType<typeof createLogger>,
): Promise<GalleryList | null> {
  try {
    const list = await fetchGalleryList({ endpoint: GALLERY_LIST_URL })
    logger.info(`   Official list: ${list.total} entries`)
    return list
  } catch (err: unknown) {
    logger.warn({ err: errorMessage(err) }, 'gallery list unavailable')
    return null
  }
}

function printSummary(logger: ReturnType<typeof createLogger>, report: RunReport): void {
  const m = report.download
  const g = report.gallery

  logger.info('========================================')
  logger.info('           DOWNLOAD SUMMARY')
  logger.info('========================================')
  logger.info(`  Wallpapers in list : ${report.discovery.combinedCount}`)
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
  if (g.officialTotal === null) {
    logger.info('  Official wallpapers : unavailable (list endpoint failed)')
  } else {
    const delta =
      g.newSinceLastRun === null ? 'new: unknown (first record)' : `+${g.newSinceLastRun} new`
    logger.info(`  Official wallpapers : ${g.officialTotal}  (${delta})`)
    if (g.newFiles.length > 0) logger.info(`  New this run        : ${g.newFiles.join(', ')}`)
    if (g.mirror) {
      logger.info(`  Missing from disk   : ${g.mirror.missingFromDisk.count}`)
      logger.info(`  Not in the gallery  : ${g.mirror.extraOnDisk.count}`)
    }
  }
  const coverage = report.discovery.coverage
  logger.info(
    `  Discovery coverage  : ${
      coverage === null ? 'unknown' : `${(coverage * 100).toFixed(1)}% of the gallery list`
    }`,
  )
  logger.info('========================================')
}

/**
 * Refresh the cross-run gallery state from the official list: what is new since
 * the previous Run, and how the mirror compares to the list. A failure to
 * persist must not cost the Run its report, so it only warns.
 */
function updateGalleryStats(
  logger: ReturnType<typeof createLogger>,
  meta: RunMeta,
  at: string,
  list: GalleryList | null,
): GalleryStats {
  const previous = readGalleryState(GALLERY_STATE_FILE)
  if (list === null) return unavailableGalleryStats(previous)

  const diskFiles = fs.existsSync(IMAGES_DIR) ? fs.readdirSync(IMAGES_DIR) : []
  const { state, stats } = mergeGalleryStats(previous, { list, diskFiles }, meta.runId, at)
  try {
    writeGalleryState(GALLERY_STATE_FILE, state)
  } catch (err: unknown) {
    logger.warn({ err: errorMessage(err) }, 'failed to persist gallery state')
  }
  return stats
}

function finishRun(
  logger: ReturnType<typeof createLogger>,
  meta: RunMeta,
  discovery: DiscoveryResult,
  outcomes: DownloadOutcome[],
  galleryList: GalleryList | null,
): RunReport {
  const finishedAt = new Date().toISOString()
  const metrics = classifyOutcomes(outcomes)
  const gallery = updateGalleryStats(logger, meta, finishedAt, galleryList)
  const report = buildRunReport(meta, finishedAt, {
    discovery: discovery.stats,
    metrics,
    gallery,
    ...discovery.capture,
  })

  logger.info(report, 'run report')

  const d = report.defects
  if (d.nonConverged) logger.warn({ defect: 'nonConverged' }, 'the gallery list did not answer')
  if (d.emptyResult)
    logger.warn({ defect: 'emptyResult' }, 'no Wallpapers to download — was the list read?')
  if (d.persistentFailures > 0)
    logger.warn(
      { defect: 'persistentFailures', count: d.persistentFailures },
      'downloads failed even after retry',
    )
  if (d.emptyFiles.length > 0)
    logger.warn(
      { defect: 'emptyFiles', files: d.emptyFiles },
      'downloaded files were empty (0 bytes)',
    )
  if (d.gallerySourceUnavailable)
    logger.warn(
      { defect: 'gallerySourceUnavailable' },
      'gallery list unavailable — total and mirror check unknown',
    )
  if (d.mirrorGap !== null && d.mirrorGap.missing > 0)
    logger.warn(
      {
        defect: 'mirrorGap',
        missing: d.mirrorGap.missing,
        files: gallery.mirror?.missingFromDisk.files,
      },
      'the official gallery lists Wallpapers that are not on disk',
    )
  if (d.mirrorGap !== null && d.mirrorGap.extra > 0)
    logger.warn(
      { defect: 'mirrorGap', extra: d.mirrorGap.extra, files: gallery.mirror?.extraOnDisk.files },
      'files on disk that the official gallery does not list',
    )

  return report
}

// ── main ────────────────────────────────────────────────────────────

/**
 * Bring the data directory to the current layout before anything writes into
 * it. This is the one place a Run can move the pre-#80 checkout's data (by
 * rename); an unrecognised or newer layout refuses here, before the logger, so
 * the data is exactly as it was found.
 */
function ensureUsableDataLayout(): void {
  const result = ensureDataLayout({
    appRoot: APP_ROOT,
    dataRoot: DATA_ROOT,
    configuredImagesDir: IMAGES_DIR_SETTING,
    configuredLogDir: LOG_DIR_SETTING,
  })
  if (!result.ok) {
    console.error(result.refusal.message)
    process.exit(1)
  }
  for (const move of result.ready.migrated) {
    process.stdout.write(`数据已搬迁：${move.source} → ${move.target}\n`)
  }
}

async function main() {
  ensureUsableDataLayout()
  const logger = createLogger(LOG_DIR)

  const { meta, config } = newRunMeta()
  logger.info(
    { type: 'run_meta', runId: meta.runId, startedAt: meta.startedAt, config },
    'run started',
  )
  // The user layer's one line, after `run_meta` and before the Run's first
  // event: a user who edited `data/user.env` can see in the terminal and in the
  // Run log that it was accepted, and which keys it contributed (#78). It must
  // not precede `run_meta` — that record opens the log, and the Orphaned Run
  // reader takes the first line as the Run's identity.
  if (USER_CONFIG_NOTICE !== null) logger.info(USER_CONFIG_NOTICE)

  // 1. Discovery. One unauthenticated request carries the whole gallery, so
  // every Run starts from the same complete URL set the site lists (#76).
  logger.info('1. Asking the gallery list...')
  const discoveryStartedAt = Date.now()
  const galleryList = await loadGalleryList(logger)
  const discovery = discoverFromList(galleryList, Date.now() - discoveryStartedAt)
  logger.info(`   Wallpapers to download: ${discovery.urls.length}`)

  if (discovery.urls.length === 0) {
    logger.warn('No Wallpapers to download: the gallery list was not read.')
    printSummary(logger, finishRun(logger, meta, discovery, [], galleryList))
    return
  }

  // 2. Download every URL in the list.
  logger.info('2. Downloading images...')
  fs.mkdirSync(IMAGES_DIR, { recursive: true })

  const outcomes = await downloadBatch(discovery.urls, IMAGES_DIR, BATCH_SIZE, logger)

  // 3. Summarize, report and print.
  printSummary(logger, finishRun(logger, meta, discovery, outcomes, galleryList))
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
