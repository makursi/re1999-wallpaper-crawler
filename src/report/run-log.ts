// ── Run log: reading a Run's verdict back ───────────────────────────
//
// `src/report/report.ts` builds a Run report from a Run's data; this module
// reads one back. It answers the question the operator runbook asks at the end
// of a Run — was it clean? — from the Run log's own records, so the answer is
// mechanical rather than four hand-written parses and a reconciliation done in
// the agent's head.
//
// The module is pure: the filesystem stays in the CLI entry (`src/check-run.ts`),
// which passes in the file check as a probe. That is what keeps the verdict
// testable without a filesystem.
//
// Two inversions the runbook insists on, encoded here:
//   - a Run log that stops before its `run_report` is a defect in the log, not
//     evidence that the Run failed;
//   - "not checked" (`null` Mirror gap, `null` Site asset check) is never folded
//     into "clean".

import { z } from 'zod'

import type { GalleryState } from '../gallery/gallery-state.js'
import type { RunReport } from './report.js'

/** The Run report's defect block, as `type: run_report` writes it. */
export type RunDefects = RunReport['defects']

export type VerdictState = 'clean' | 'explained' | 'defect'

/**
 * The verdict: not a boolean, because the runbook asks the operator to judge
 * facts (numbers, defects, the state match) that a boolean would throw away.
 */
export interface RunVerdict {
  verdict: VerdictState
  /** The Run this verdict is about; `null` when no Run report was found. */
  runId: string | null
  reportPresent: boolean
  /** `null` when the Gallery state is unreadable — never confused with `false`. */
  stateMatchesReport: boolean | null
  /** Claimed new files the probe rejected (absent, or zero bytes). */
  missingOnDisk: string[]
  /** The Run report's defect block, verbatim, so the verdict cannot disagree with the log. */
  defects: RunDefects | null
  /** The routine defect classes that were detected, named. */
  explained: string[]
}

/**
 * Answers "is this Wallpaper on disk with a non-zero size?". Injected so the
 * verdict never touches the filesystem; the CLI entry supplies the real one.
 */
export type FileProbe = (filename: string) => boolean

// ── the Run report record ──────────────────────────────────────────

// A Run report record and every part of it, so what comes back really is the
// record the log carried. Every field that can be `null` in the contract stays
// nullable — a `null` that silently became `0` would turn "not checked" into
// "clean". The report is written by this repo, so the check guards against a
// truncated or foreign record, not an adversary.
const gapSchema = z.object({ count: z.number().int(), files: z.array(z.string()) })

const discoverySchema = z.object({
  converged: z.boolean(),
  stableRounds: z.number().int(),
  totalIdleSec: z.number(),
  networkCount: z.number().int(),
  domCount: z.number().int(),
  combinedCount: z.number().int(),
  thumbnailsClicked: z.number().int(),
  discoveryDurationMs: z.number(),
  coverage: z.number().nullable(),
})

const failureSchema = z.object({
  url: z.string(),
  status: z.number().optional(),
  reason: z.string(),
  retried: z.boolean(),
})

const downloadSchema = z.object({
  total: z.number().int(),
  ok: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  successRate: z.number(),
  retryRescued: z.number().int(),
  retryTotal: z.number().int(),
  rescueRate: z.number(),
  emptyFiles: z.number().int(),
  emptyFilenames: z.array(z.string()),
  persistentFailures: z.number().int(),
  totalBytes: z.number(),
  avgDownloadMs: z.number(),
  statusHistogram: z.record(z.string(), z.number().int()),
  failureGroups: z.array(z.object({ status: z.string(), count: z.number().int() })),
  failures: z.array(failureSchema),
})

const galleryStatsSchema = z.object({
  officialTotal: z.number().int().nullable(),
  newSinceLastRun: z.number().int().nullable(),
  newFiles: z.array(z.string()),
  firstRun: z.boolean(),
  mirror: z.object({ missingFromDisk: gapSchema, extraOnDisk: gapSchema }).nullable(),
})

const defectsSchema = z.object({
  discoveryLeak: z.object({ count: z.number().int(), urls: z.array(z.string()) }),
  nonConverged: z.boolean(),
  emptyResult: z.boolean(),
  persistentFailures: z.number().int(),
  emptyFiles: z.array(z.string()),
  siteAssetFalsePositive: z
    .object({ count: z.number().int(), urls: z.array(z.string()) })
    .nullable(),
  gallerySourceUnavailable: z.boolean(),
  mirrorGap: z.object({ missing: z.number().int(), extra: z.number().int() }).nullable(),
})

const reportSchema: z.ZodType<RunReport> = z
  .object({
    type: z.literal('run_report'),
    runId: z.string(),
    startedAt: z.string(),
    finishedAt: z.string(),
    durationMs: z.number(),
    discovery: discoverySchema,
    download: downloadSchema,
    gallery: galleryStatsSchema,
    siteAssets: z.object({ count: z.number().int(), urls: z.array(z.string()) }),
    defects: defectsSchema,
    failures: z.array(failureSchema),
  })
  .refine(
    // Both `null`s mean "the Gallery list was unavailable, so this was not
    // checked"; a record where only one is `null` is not one this repo wrote,
    // and accepting it would open the door to a half-checked Run reading clean.
    ({ gallery, defects }) =>
      (gallery.mirror === null) === (defects.mirrorGap === null) &&
      (gallery.mirror === null) === (defects.siteAssetFalsePositive === null),
    { error: 'the Mirror gap and the Site asset check disagree about being checked' },
  )

/**
 * The `run_report` record in a Run log's text, or `null`.
 *
 * `null` covers both cases the caller must tell apart — "the log carries no
 * `run_report`" and "the log is unreadable/truncated" — because only the caller,
 * with the Gallery state in hand, can distinguish a lost report from a Run that
 * never got that far. The report is one record among many and is not assumed to
 * be the last line: a line that is not parseable JSON is skipped, so a log cut
 * off mid-write still yields the report that precedes it.
 */
export function parseRunReport(logText: string): RunReport | null {
  for (const line of logText.split(/\r?\n/)) {
    if (!line.includes('"run_report"')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const report = reportSchema.safeParse(parsed)
    if (report.success) return report.data
  }
  return null
}

// ── the verdict ────────────────────────────────────────────────────

/** Every defect class the runbook does not call routine. */
function unexplainedDefects(defects: RunDefects, siteAssetUrls: readonly string[]): string[] {
  const found: string[] = []
  if (defects.nonConverged) found.push('nonConverged')
  if (defects.emptyResult) found.push('emptyResult')
  if (defects.persistentFailures > 0) found.push('persistentFailures')
  if (defects.emptyFiles.length > 0) found.push('emptyFiles')
  if (defects.siteAssetFalsePositive === null) found.push('siteAssetFalsePositive: not checked')
  else if (defects.siteAssetFalsePositive.count > 0) found.push('siteAssetFalsePositive')
  if (defects.gallerySourceUnavailable) found.push('gallerySourceUnavailable')
  // A `null` Mirror gap is "not checked", which the runbook never accepts as clean.
  if (defects.mirrorGap === null) found.push('mirrorGap: not checked')
  else if (defects.mirrorGap.missing > 0) found.push('mirrorGap: missing')
  // The one judgement the command makes: a leak is routine only when every one
  // of its URLs is also in the report's Site asset list (the runbook's subset
  // rule), and extra files on the Mirror are the retired-art case.
  const leaked = defects.discoveryLeak.urls
  // `some` is `false` for an empty list, which is what "no leak" means here.
  if (leaked.some(url => !siteAssetUrls.includes(url))) found.push('discoveryLeak')
  return found
}

/** The routine classes that were detected, named for the output. */
function explainedDefects(defects: RunDefects, siteAssetUrls: readonly string[]): string[] {
  const named = defects.discoveryLeak.urls
    .filter(url => siteAssetUrls.includes(url))
    .map(url => `discoveryLeak: ${url}`)
  if (defects.mirrorGap !== null && defects.mirrorGap.extra > 0)
    named.push(`mirrorGap: extra ${defects.mirrorGap.extra}`)
  return named
}

/**
 * The verdict for one Run. Pure: the file check arrives as the `probe`.
 *
 * A defect is anything the report found that the runbook does not call routine
 * — non-convergence, an empty result, persistent failures, empty files, a Site
 * asset false positive, an unavailable Gallery source, or a Mirror gap with
 * files missing — plus a claimed new file the probe rejects, plus a Gallery
 * state that does not match the report (or cannot be read). A missing report is
 * a defect in the log, stated as such rather than implied by empty output.
 */
export function assessRun(
  report: RunReport | null,
  state: GalleryState | null,
  probe: FileProbe,
): RunVerdict {
  if (report === null) {
    return {
      verdict: 'defect',
      runId: null,
      reportPresent: false,
      stateMatchesReport: state === null ? null : false,
      missingOnDisk: [],
      defects: null,
      explained: [],
    }
  }

  const stateMatchesReport = state === null ? null : state.runId === report.runId
  const siteAssetUrls = report.siteAssets.urls
  const explained = explainedDefects(report.defects, siteAssetUrls)
  const missingOnDisk = report.gallery.newFiles.filter(filename => !probe(filename))
  const unexplained = unexplainedDefects(report.defects, siteAssetUrls)
  const defect = stateMatchesReport !== true || missingOnDisk.length > 0 || unexplained.length > 0

  return {
    verdict: defect ? 'defect' : explained.length > 0 ? 'explained' : 'clean',
    runId: report.runId,
    reportPresent: true,
    stateMatchesReport,
    missingOnDisk,
    defects: report.defects,
    explained,
  }
}
