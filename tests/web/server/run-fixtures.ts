// ── Run fixtures, built as data ─────────────────────────────────────
//
// A Run report record, a Gallery state, and the log lines around them — the
// shapes `tests/core/report/run-log.test.ts` uses, shared by the Console's tests
// so every one of them is talking about the same Run. Nothing here invents a
// field the Run report contract does not have.
//
// The Console's HTTP tests also share the three things every one of them needs:
// the token the guard is given, a temporary repository root, and the
// configuration derived from it. One home for those keeps a route test's fixture
// from drifting from the others'.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { GalleryState } from '../../../core/gallery/gallery-state.js'
import type { RunReport } from '../../../core/report/report.js'
import type { RunDefects } from '../../../core/report/run-log.js'
import type { ConsoleConfig } from '../../../web/server/console-config.js'
import type { RunLogSourceOptions } from '../../../web/server/run-log-source.js'

/** The access token every Console test presents; the service generates a real one. */
export const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

export const RUN_ID = '2026-10-18T01-03-31'
export const STARTED_AT = '2026-10-18T01:03:31.856Z'
/** The name today's writer emits: `core/logger.ts`'s `run-<runId>.jsonl`. */
export const LOG_NAME = `run-${RUN_ID}.jsonl`
/** The name every log already in `logs/` carries — still read, never renamed. */
export const LEGACY_LOG_NAME = `save-wallpapers-${RUN_ID}.jsonl`
export const NEW_FILES = ['1024_abc.jpg', '1023_def.png']

export function defects(over: Partial<RunDefects> = {}): RunDefects {
  return {
    discoveryLeak: { count: 0, urls: [] },
    nonConverged: false,
    emptyResult: false,
    persistentFailures: 0,
    emptyFiles: [],
    siteAssetFalsePositive: { count: 0, urls: [] },
    gallerySourceUnavailable: false,
    mirrorGap: { missing: 0, extra: 0 },
    ...over,
  }
}

/** A Run report record, as `core/main.ts` writes it — the JSONL line itself. */
export function runReport(over: Partial<RunReport> = {}): RunReport {
  return {
    type: 'run_report',
    runId: RUN_ID,
    startedAt: STARTED_AT,
    finishedAt: '2026-10-18T01:07:09.045Z',
    durationMs: 217189,
    discovery: {
      converged: true,
      stableRounds: 6,
      totalIdleSec: 60,
      networkCount: 78,
      domCount: 75,
      combinedCount: 79,
      thumbnailsClicked: 15,
      discoveryDurationMs: 173592,
      coverage: 0.0446,
    },
    download: {
      total: 12,
      ok: 12,
      skipped: 0,
      failed: 0,
      successRate: 1,
      retryRescued: 0,
      retryTotal: 0,
      rescueRate: 0,
      emptyFiles: 0,
      emptyFilenames: [],
      persistentFailures: 0,
      totalBytes: 85830065,
      avgDownloadMs: 4790,
      statusHistogram: { 200: 12 },
      failureGroups: [],
      failures: [],
    },
    gallery: {
      officialTotal: 1010,
      newSinceLastRun: NEW_FILES.length,
      newFiles: NEW_FILES,
      firstRun: false,
      mirror: {
        missingFromDisk: { count: 0, files: [] },
        extraOnDisk: { count: 0, files: [] },
      },
    },
    siteAssets: { count: 1, urls: ['https://re.bluepoch.com/home/detail.html'] },
    defects: defects(),
    failures: [],
    ...over,
  }
}

/** The Gallery state `check-run` compares the report against. */
export function galleryState(over: Partial<GalleryState> = {}): GalleryState {
  return {
    version: 1,
    ids: [1012, 1013],
    updatedAt: '2026-10-18T01:07:09.045Z',
    runId: RUN_ID,
    ...over,
  }
}

/** The first record of a Run log. */
export function runMetaLine(runId: string = RUN_ID, startedAt: string = STARTED_AT): string {
  return JSON.stringify({ type: 'run_meta', runId, startedAt, msg: 'run started' })
}

/** An ordinary Run log record: no `type`, so not part of the log's contract. */
export function plainLine(message = 'working'): string {
  return JSON.stringify({ level: 30, time: 1792285411856, msg: message })
}

/** A Run log: the `run_meta` record first, then whatever the caller passes. */
export function runLog(...records: string[]): string {
  return [runMetaLine(), ...records].join('\n')
}

/**
 * A fixture repository root: a fresh temporary directory holding an empty Mirror
 * (`images/`) and an empty Run log directory (`logs/`).
 *
 * The caller owns the directory — push it onto its own `roots` array so its
 * `afterEach` can remove it — and seeds whatever its test needs.
 */
export function fixtureProjectRoot(prefix: string): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  fs.mkdirSync(path.join(projectRoot, 'images'))
  fs.mkdirSync(path.join(projectRoot, 'logs'))
  return projectRoot
}

/** The Console's configuration over a fixture project root. */
export function consoleConfigIn(projectRoot: string): ConsoleConfig {
  const imagesDir = path.join(projectRoot, 'images')
  return {
    projectRoot,
    imagesDir,
    logDir: path.join(projectRoot, 'logs'),
    galleryStateFile: path.join(imagesDir, '.gallery-state.json'),
    // The built page lives under the web layer's root, beside its config —
    // `web/dist` in the real repository. Mirrored here so a fixture's layout is
    // the production one, one level deeper than the fixture project root.
    distDir: path.join(projectRoot, 'web', 'dist'),
    galleryListEndpoint: 'https://gallery.test/query',
  }
}

/**
 * A Run log source's options over a fixture project root: the Mirror and the log
 * directory `fixtureProjectRoot` created, and the Gallery state file inside the
 * Mirror.
 */
export function runLogSourceOptionsIn(projectRoot: string): RunLogSourceOptions {
  const config = consoleConfigIn(projectRoot)
  return {
    logDir: config.logDir,
    imagesDir: config.imagesDir,
    galleryStateFile: config.galleryStateFile,
  }
}
