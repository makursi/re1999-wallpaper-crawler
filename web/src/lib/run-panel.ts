// ── The Run panel's rules (#97) ─────────────────────────────────────
//
// The panel holds four lines: one verdict sentence, `ok N · failed N`, the
// figures line the wall's header shows (#94), and at most one problem line. The
// verdict sentence and the figures are not this file's — the dictionary owns the
// first, `lib/gallery-figures.ts` computes the second. What is here is the two
// rules a finished Run's panel applies:
//
//   - `runCountsOf`: `ok N`, and ` · failed N` only when something failed. A
//     clean Run reads `ok 1013`, never `ok 1013 · failed 0` — the zero is not a
//     number the reader needs, and printing it makes a clean Run look measured
//     for problems.
//   - `runProblemOf`: at most one problem line, chosen by priority. The report's
//     defect block, the verdict's own reasons and a lost report are four
//     different vocabularies; a player gets one sentence, not nine rows.
//
// It also carries `runProgressOf`, the in-flight line: "downloaded N of M", and
// a sentence that still names N when the list has not been read. The wall's band
// and the panel both show progress while a Run writes, and neither may fall back
// to a spinner (#83).
//
// Pure functions, both: the status payload arrives as data, so the panel and the
// tests feed these the same way, and the choice of sentence stays out of a
// template where nothing can pin it.

import type { ConsoleRunReport, ConsoleStatusPayload } from '../../api-types.js'
import type { MessageRow } from '../i18n/messages.js'

/**
 * The facts the panel's problem line is chosen from: four fields of the status
 * payload, nothing re-derived. A component passes the payload whole, which is
 * why this is a `Pick` rather than a hand-built object — a second shape would be
 * a second place to keep in step with the contract.
 */
export type RunProblemFacts = Pick<
  ConsoleStatusPayload,
  'verdict' | 'reportPresent' | 'report' | 'verdictReasons'
>

/**
 * The counts line: `ok N`, plus the failure clause only when a download failed.
 *
 * `ok` is what succeeded and `failed` is what did not — never the success rate,
 * the retry rescue or the status histogram #47 used to print. Skipped entries are
 * not failures: they were already on disk, and the reader asked "did it get
 * everything", not "how many requests did it make".
 *
 * An empty list is "there is no report to count", which the panel renders as
 * nothing at all: a missing report is the problem line's statement, not a row of
 * zeroes.
 */
export function runCountsOf(report: ConsoleRunReport | null): MessageRow[] {
  if (report === null) return []
  const { ok, failed } = report.download
  const rows: MessageRow[] = [{ key: 'run.counts', params: { ok } }]
  if (failed > 0) rows.push({ key: 'run.countsFailed', params: { failed } })
  return rows
}

/**
 * The one problem line a Run is allowed to show, or `null` when there is none.
 *
 * Priority, highest first — the order the spec fixes, because the first fact is
 * the one that made the rest unmeasurable:
 *
 *   1. the report is missing — the log stops before its verdict;
 *   2. the report is present but unreadable — an older Run contract;
 *   3. files that downloaded empty (the names, since they are what to look at);
 *   4. Wallpapers that kept failing (the count);
 *   5. the site could not be reached — nothing was downloaded at all;
 *   6. the list came back empty, so there was nothing to download;
 *   7. the Mirror gap still names listed Wallpapers the disk does not hold;
 *   8. the verdict's own causes — a Gallery state that names another Run (or
 *      could not be read), and claimed new files the probe rejected.
 *
 * Branches 3-8 are statements about a report, so they only speak for a `defect`:
 * an `explained` Run's routine extra is recorded, not failed, and its verdict
 * sentence already says so.
 *
 * A lost report is `defect` too, in `assessRun`'s vocabulary ("a defect in the
 * log"), which is why branches 1-2 come before the verdict check: with no report
 * there is no defect block to choose from, and "no conclusion" is the honest
 * sentence. That is also the difference the panel must keep — a missing report
 * is not evidence the Run failed (AGENTS.md).
 *
 * Every report this pipeline writes names one of branches 3-8 when it is a
 * defect: `nonConverged`, a `null` Mirror gap and a `null` site-asset check all
 * mean the list was unavailable, which is branch 5. A legacy report carrying
 * only a class this panel no longer words therefore reads as its verdict alone
 * rather than as an invented sentence.
 */
export function runProblemOf(facts: RunProblemFacts): MessageRow | null {
  const { report, reportPresent, verdict, verdictReasons } = facts

  if (report === null) {
    return { key: reportPresent ? 'run.reportUnreadable' : 'run.reportMissing' }
  }
  if (verdict !== 'defect') return null

  const defects = report.defects
  if (defects.emptyFiles.length > 0) {
    return { key: 'defect.emptyFiles', params: { files: defects.emptyFiles.join(', ') } }
  }
  if (defects.persistentFailures > 0) {
    return { key: 'defect.persistentFailures', params: { count: defects.persistentFailures } }
  }
  if (defects.gallerySourceUnavailable) return { key: 'run.siteUnreachable' }
  if (defects.emptyResult) return { key: 'defect.emptyResult' }
  if (defects.mirrorGap !== null && defects.mirrorGap.missing > 0) {
    return { key: 'defect.mirrorGapMissing', params: { count: defects.mirrorGap.missing } }
  }

  // The verdict's own causes, in the order they are decided: a state that names
  // another Run makes the whole cross-check untrustworthy, an unreadable one
  // says so, and the rejected files are the concrete thing left to look at.
  if (verdictReasons === null) return null
  if (verdictReasons.stateMatchesReport === false) {
    return { key: 'run.cause.stateNamesAnotherRun' }
  }
  if (verdictReasons.stateMatchesReport === null) {
    return { key: 'run.cause.stateUnreadable' }
  }
  if (verdictReasons.missingOnDisk.length > 0) {
    return {
      key: 'run.cause.missingOnDisk',
      params: { files: verdictReasons.missingOnDisk.join(', ') },
    }
  }
  return null
}

/**
 * The in-flight line: how many Wallpapers are downloaded of the Gallery total.
 *
 * `done` is the status's live Mirror count — it moves as a Run writes — and
 * `total` is the list's own total, or `null` when the list was not read yet. An
 * unread list does not silence the progress: the sentence keeps the downloaded
 * count and says the total is not known.
 */
export function runProgressOf(done: number, total: number | null): MessageRow {
  return total === null
    ? { key: 'wall.progressUnknownTotal', params: { done } }
    : { key: 'wall.progress', params: { done, total } }
}
