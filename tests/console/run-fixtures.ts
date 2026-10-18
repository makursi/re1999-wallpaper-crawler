// ── Run fixtures, built as data ─────────────────────────────────────
//
// A Run report record, a Gallery state, and the log lines around them — the
// shapes `tests/report/run-log.test.ts` uses, shared by the Console's tests so
// every one of them is talking about the same Run. Nothing here invents a
// field the Run report contract does not have.

import type { GalleryState } from '../../src/gallery/gallery-state.js'
import type { RunReport } from '../../src/report/report.js'
import type { RunDefects } from '../../src/report/run-log.js'

export const RUN_ID = '2026-10-18T01-03-31'
export const STARTED_AT = '2026-10-18T01:03:31.856Z'
export const LOG_NAME = `save-wallpapers-${RUN_ID}.jsonl`
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

/** A Run report record, as `src/main.ts` writes it — the JSONL line itself. */
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
