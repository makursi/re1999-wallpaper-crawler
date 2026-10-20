// ── Run log: reading a Run's verdict back ───────────────────────────
//
// `core/report/report.ts` builds a Run report from a Run's data; this module
// reads one back. It answers the question the operator runbook asks at the end
// of a Run — was it clean? — from the Run log's own records, so the answer is
// mechanical rather than four hand-written parses and a reconciliation done in
// the agent's head.
//
// The module is pure: the filesystem stays in the CLI entry (`core/check-run.ts`),
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
 * One routine defect class the verdict explained — structured data, not a
 * sentence (#47). `check-run` formats these for its terminal output; the page
 * formats the same values in the reader's language, and neither owns the other's
 * words.
 */
export type RunExplainedReason =
  | { kind: 'discovery-leak'; urls: string[] }
  | { kind: 'mirror-gap-extra'; count: number }

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
  /** The routine defect classes that were detected, as structured reasons. */
  explained: RunExplainedReason[]
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

// The annotation is load-bearing, not decoration: `z.ZodType<RunReport>` makes
// the compiler refuse this schema the moment the contract in `report.ts` gains a
// required field the schema does not carry — measured by adding one to
// `DiscoveryStats`, which fails right here with TS2322. Do not drop it for a
// bare `z.object`.
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
    // checked". The invariant is the writer's: all three come from the single
    // list fetch in `main.ts`, which `unavailableGalleryStats` in
    // `gallery-state.ts` encodes. A record where only one is `null` is not one
    // this repo wrote, and accepting it would open the door to a half-checked
    // Run reading clean.
    ({ gallery, defects }) =>
      (gallery.mirror === null) === (defects.mirrorGap === null) &&
      (gallery.mirror === null) === (defects.siteAssetFalsePositive === null),
    { error: 'the Mirror gap and the Site asset check disagree about being checked' },
  )

/** The log lines that mention a `run_report`, which the read and the check both start from. */
function runReportLines(logText: string): string[] {
  return logText.split(/\r?\n/).filter(line => line.includes('"run_report"'))
}

/**
 * The `run_report` record in a Run log's text, or `null`.
 *
 * `null` covers more than one case, so the caller must not read it as "there is
 * no report": it also means a record this command's schema refuses — an older
 * Run contract, since `logs/` holds reports from before `discovery.coverage`,
 * the Mirror gap and the Site asset check existed — and a log cut off mid-write.
 * `runReportRecordPresent` carries the fact `null` cannot. The report is one
 * record among many and is not assumed to be the last line: a line that is not
 * parseable JSON is skipped, so a log truncated at the end still yields the
 * report that precedes it.
 */
export function parseRunReport(logText: string): RunReport | null {
  for (const line of runReportLines(logText)) {
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

/**
 * Whether the log carries a readable `run_report` record, whatever shape it is
 * in — the fact `parseRunReport`'s `null` cannot carry on its own.
 *
 * A record this command does not recognise is still a record. Reporting it as a
 * missing report would be a false statement about the log, and the runbook reads
 * a missing report as "the Run's last step never ran", which is a different
 * finding altogether.
 */
export function runReportRecordPresent(logText: string): boolean {
  return runReportLines(logText).some(line => {
    try {
      JSON.parse(line)
      return true
    } catch {
      return false
    }
  })
}

// ── the Run log's name ─────────────────────────────────────────────

// The one pattern that decides what a Run log name is. Two prefixes are
// accepted and both are permanent: the writer's current `run-<runId>.jsonl` and
// the legacy `save-wallpapers-<runId>.jsonl` that every log already on disk
// carries. The old files are a historical fact, not a transitional state —
// nothing is renamed — so this is not an expiry-dated branch (ADR 0016).
//
// It lives here, in the pure layer, because three seams need the same answer:
// the newest-log pick (`core/run-log-file.ts`), the verdict's log-to-Run
// identification (`assessRun`'s `logRunId`), and the tests. A pattern repeated
// in the filesystem reader could drift from this one and make the page and
// `check-run` disagree about which file is a Run log.
const RUN_LOG_NAME = /^(?:save-wallpapers-|run-)(.+)\.jsonl$/

/**
 * The Run a log file belongs to, from its name, or `null` when the name is not
 * a Run log.
 *
 * This is what lets a *missing* Run report still answer "did the Run finish?".
 * The Gallery state's `runId` is written by a Run's last step, so a state naming
 * this log's Run means the Run finished and only its report is lost, while a
 * state naming an older Run means this one never got that far.
 *
 * The `runId` half of the shared name pair: the pick orders by it, because the
 * whole file name cannot be compared across the two prefixes (see
 * `newestRunLogName`).
 */
export function logRunIdOf(filename: string): string | null {
  return RUN_LOG_NAME.exec(filename)?.[1] ?? null
}

/**
 * Whether a name is a Run log's — the other half of the pair. `false` covers
 * every `.jsonl` that is not one of ours: a notes file, a `.bak`, a truncated
 * name, or a prefix that only appears inside a longer name.
 */
export function isRunLogName(filename: string): boolean {
  return logRunIdOf(filename) !== null
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
  // A leak is routine only as a whole, so a partly-accounted leak is a defect.
  if (defects.discoveryLeak.urls.length > 0 && !leakAccountedFor(defects, siteAssetUrls))
    found.push('discoveryLeak')
  return found
}

/**
 * Whether the report accounts for its whole leak — the runbook's subset rule,
 * and the one judgement this command makes about a leak. `false` for an empty
 * leak, which is "no leak", not "an explained one".
 */
function leakAccountedFor(defects: RunDefects, siteAssetUrls: readonly string[]): boolean {
  const leaked = defects.discoveryLeak.urls
  return leaked.length > 0 && leaked.every(url => siteAssetUrls.includes(url))
}

/**
 * The routine classes that were detected, as structured reasons. Data, not
 * prose: `check-run` is one formatter and the page is another (`#47`).
 */
function explainedDefects(
  defects: RunDefects,
  siteAssetUrls: readonly string[],
): RunExplainedReason[] {
  const named: RunExplainedReason[] = []
  if (leakAccountedFor(defects, siteAssetUrls))
    named.push({ kind: 'discovery-leak', urls: [...defects.discoveryLeak.urls] })
  if (defects.mirrorGap !== null && defects.mirrorGap.extra > 0)
    named.push({ kind: 'mirror-gap-extra', count: defects.mirrorGap.extra })
  return named
}

/**
 * The verdict for one Run. Pure: the file check arrives as the `probe`, and the
 * Run the log belongs to as `logRunId` (`logRunIdOf`, from the log's filename).
 *
 * A defect is anything the report found that the runbook does not call routine
 * — non-convergence, an empty result, persistent failures, empty files, a Site
 * asset false positive, an unavailable Gallery source, or a Mirror gap with
 * files missing — plus a claimed new file the probe rejects, plus a Gallery
 * state that does not match the report (or cannot be read). A missing report is
 * a defect in the log, stated as such rather than implied by empty output.
 *
 * With no report there is no `runId` to compare, so the Gallery state is matched
 * against `logRunId` instead — without it a lost report cannot be told from a
 * Run that never reached its last step.
 */
export function assessRun(
  report: RunReport | null,
  state: GalleryState | null,
  probe: FileProbe,
  logRunId: string | null = null,
): RunVerdict {
  if (report === null) {
    return {
      verdict: 'defect',
      runId: null,
      reportPresent: false,
      stateMatchesReport: state === null ? null : logRunId !== null && state.runId === logRunId,
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
