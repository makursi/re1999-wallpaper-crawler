// ── The status payload's assembly ───────────────────────────────────
//
// Two layers, deliberately:
//
//   - `deriveRunFacts` is the pure Run half. The newest log's text and mtime,
//     the Gallery state and the file probe go in; the verdict and the state
//     come out. Every input is injected, so it needs no filesystem and no
//     clock, and a test can pin every verdict `check-run` prints.
//   - `buildStatus` is the assembly #32 declared, and the seam the server
//     injects against.
//
// The verdict is `parseRunReport` + `assessRun` on the newest log `check-run`
// would pick, with the same `FileProbe` semantics and `logRunIdOf(name)` as the
// fourth argument — that is what makes "the page and the command cannot
// disagree" a structural fact rather than a promise (spec decision 16). The
// report is carried verbatim beside it, because #34 shows the Run's Gallery
// numbers, Download numbers and defects together.
//
// #34 extends this file; #33 owns `ConsoleGalleryFacts`, which is untouched.

import type { GalleryList } from '../../core/gallery/gallery-source.js'
import type { GalleryState } from '../../core/gallery/gallery-state.js'
import type { RunReport } from '../../core/report/report.js'
import type { FileProbe, RunDefects, RunVerdict } from '../../core/report/run-log.js'
import { assessRun, logRunIdOf, parseRunReport } from '../../core/report/run-log.js'
import type {
  ConsoleDefects,
  ConsoleRunReport,
  ConsoleRunState,
  ConsoleStatusPayload,
  ConsoleVerdict,
  ConsoleVerdictReasons,
} from '../api-types.js'
import { decideRunState, parseRunMeta } from './run-state.js'
import type { Same } from './same.js'

/**
 * The API's defect block, checked against the Run report's on the way through.
 *
 * `api-types.ts` declares it structurally instead of importing it, because the
 * page's tsconfig has no node types and `run-log.ts` reaches `node:fs` through
 * `gallery-state.ts`. The conditional parameter is what keeps the two from
 * drifting: a field added, dropped or retyped on either side turns the argument
 * type into `never`, so this stops compiling rather than letting the page
 * silently lose a defect class.
 */
function toApiDefects(
  defects: Same<RunDefects, ConsoleDefects> extends true ? RunDefects | null : never,
): ConsoleDefects | null {
  return defects
}

/**
 * The whole Run report, held to the page's structural declaration by the same
 * `Same` check `toApiDefects` uses: the page cannot quietly lose a field the
 * Run report grew (Gallery numbers, Download numbers and defects all travel).
 */
function toApiReport(
  report: Same<RunReport, ConsoleRunReport> extends true ? RunReport | null : never,
): ConsoleRunReport | null {
  return report
}

/**
 * The verdict's own reasons, as the API declares them — held to that declaration
 * by the same `Same` check the defect block uses, so the page cannot quietly
 * lose one of the three reasons a `defect` can be made of.
 */
type RunVerdictReasons = Pick<RunVerdict, 'stateMatchesReport' | 'missingOnDisk' | 'explained'>

function toApiVerdictReasons(
  reasons: Same<RunVerdictReasons, ConsoleVerdictReasons> extends true ? RunVerdictReasons : never,
): ConsoleVerdictReasons {
  return reasons
}

/** The Run half of the status, as a reader hands it over. */
export interface ConsoleRunFacts {
  runId: string | null
  state: ConsoleRunState
  startedAt: string | null
  verdict: ConsoleVerdict | null
  defects: RunDefects | null
  /**
   * `assessRun`'s own reasons for the verdict (#34 story 11), so the page can
   * explain a `defect` the report's own defect block does not. `null` while a
   * Run is in flight, like the verdict itself.
   */
  verdictReasons: ConsoleVerdictReasons | null
  /** The newest Run report, verbatim (#34); `null` when none was read. */
  report: RunReport | null
  /**
   * Whether the newest Run log carries a `run_report` record at all — the fact
   * `parseRunReport`'s `null` cannot carry on its own.
   */
  reportPresent: boolean
  /**
   * The newest Run log's file name (#36), so the page can name the log whose
   * claim it is offering to clean up. Optional because the idle facts #32
   * injects have no log behind them; when absent the page names what it has.
   */
  logName?: string | null
}

/** The Gallery half: what the list contributed, or that it was not read. */
export interface ConsoleGalleryFacts {
  officialTotal: number | null
  listAvailable: boolean
}

/** Everything the payload is built from. */
export interface ConsoleStatusFacts {
  run: ConsoleRunFacts
  /** The Mirror's non-dot entry count (web/server/mirror.ts). */
  mirrorCount: number
  gallery: ConsoleGalleryFacts
  /**
   * Whether a Run's configuration is usable now (#57, #60). The entry point
   * re-reads the repository's `.env` for each status assembly — one file, never
   * a `PATH` scan or a registry lookup — so a file created after the Console
   * booted clears the page's setup notice on the next read.
   */
  runConfigAvailable: boolean
}

/** No Run is in flight and no Run log has been read. */
export const IDLE_RUN_FACTS: ConsoleRunFacts = {
  runId: null,
  state: 'idle',
  startedAt: null,
  verdict: null,
  defects: null,
  verdictReasons: null,
  report: null,
  reportPresent: false,
  logName: null,
}

/** Before #33 reads the list: "not read", never "nothing missing". */
export const UNREAD_GALLERY_FACTS: ConsoleGalleryFacts = {
  officialTotal: null,
  listAvailable: false,
}

/**
 * The Run half's raw facts: everything `deriveRunFacts` is allowed to know. A
 * reader supplies the log's text and name, its mtime, the clock, whether the log
 * was in the start-up listing, whether a child of ours lives, the Gallery state
 * and the file probe — nothing here touches a filesystem itself.
 */
export interface ConsoleRunLogFacts {
  /** The newest Run log's whole text, or `null` when there is none. */
  logText: string | null
  /** Its file name, for `logRunIdOf`; `null` when there is no log. */
  logName: string | null
  /** `runReportRecordPresent(logText)` — carried, never re-derived here. */
  reportPresent: boolean
  /** The newest log's `statSync().mtimeMs`, or `null`. */
  mtimeMs: number | null
  /** Epoch milliseconds; injected so the derivation needs no clock. */
  now: number
  /** Whether the log directory listing at service start-up held this log. */
  seenAtStartup: boolean
  /** Whether a Run this Console started still has a live child. */
  liveChild: boolean
  /**
   * This Console's own child wrote the newest log and has exited (#36): the
   * state table's knowledge that a Run it was watching is dead, not a terminal
   * Run still writing.
   */
  ownChildExited?: boolean
  /**
   * The newest log's claim was acknowledged by the page's cleanup (#36). It
   * changes no file; it only stops the Console offering the same cleanup.
   */
  acknowledged?: boolean
  /** `images/.gallery-state.json` read, or `null` when unreadable. */
  galleryState: GalleryState | null
  /** `check-run`'s probe: is this Wallpaper on disk with a non-zero size? */
  probe: FileProbe
}

/**
 * The Run half, derived purely from the raw facts.
 *
 * While a Run is in flight the verdict, its defects, its reasons and the report
 * are withheld (`null`): the newest log may still be the previous Run's, and the
 * page must not present a finished Run's verdict as the one now running.
 * Everything else — the state, the identity, the record's presence — is reported
 * as read.
 */
export function deriveRunFacts(input: ConsoleRunLogFacts): ConsoleRunFacts {
  const report = parseRunReport(input.logText ?? '')
  // The log's own name says which Run it is, which is what a *missing* report
  // still needs in order to be told from a Run that never finished.
  const logRunId = input.logName === null ? null : logRunIdOf(input.logName)
  const verdict = assessRun(report, input.galleryState, input.probe, logRunId)
  const state = decideRunState({
    logText: input.logText,
    mtimeMs: input.mtimeMs,
    now: input.now,
    seenAtStartup: input.seenAtStartup,
    liveChild: input.liveChild,
    ownChildExited: input.ownChildExited,
    acknowledged: input.acknowledged,
  })
  const inFlight = state === 'running'
  const meta = parseRunMeta(input.logText)
  // The verdict's own reasons travel even when the newest log's report is the
  // previous Run's: they belong to the verdict the page is showing.
  const reasons = toApiVerdictReasons({
    stateMatchesReport: verdict.stateMatchesReport,
    missingOnDisk: verdict.missingOnDisk,
    explained: verdict.explained,
  })

  return {
    runId: meta?.runId ?? logRunId,
    state,
    startedAt: meta?.startedAt ?? null,
    verdict: inFlight ? null : verdict.verdict,
    defects: inFlight ? null : verdict.defects,
    verdictReasons: inFlight ? null : reasons,
    report: inFlight ? null : report,
    reportPresent: input.reportPresent,
    logName: input.logName,
  }
}

/**
 * The Gallery half from what `GalleryListSource.get()` returned — the same
 * source the gallery route reads, so `/api/status` and `/api/gallery` cannot
 * disagree about whether the list was read (#33).
 *
 * `officialTotal` is the list's own `total`, verbatim — never
 * `entries.length`, and never a count of files (§4.5).
 */
export function galleryFactsOf(list: GalleryList | null): ConsoleGalleryFacts {
  return list === null ? UNREAD_GALLERY_FACTS : { officialTotal: list.total, listAvailable: true }
}

/**
 * The status payload, in the one shape `web/api-types.ts` declares.
 * The fields are listed rather than spread so that a change to the contract
 * has to be made here as well.
 */
export function buildStatus({
  run,
  mirrorCount,
  gallery,
  runConfigAvailable,
}: ConsoleStatusFacts): ConsoleStatusPayload {
  const payload: ConsoleStatusPayload = {
    runId: run.runId,
    state: run.state,
    startedAt: run.startedAt,
    mirrorCount,
    officialTotal: gallery.officialTotal,
    verdict: run.verdict,
    defects: toApiDefects(run.defects),
    verdictReasons: run.verdictReasons,
    listAvailable: gallery.listAvailable,
    // #57: the one setup fact the page needs, carried beside the two halves.
    runConfigAvailable,
    report: toApiReport(run.report),
    reportPresent: run.reportPresent,
  }
  // #36's additive field, present only when a log was read: the page names the
  // log whose claim it offers to clean up, and a Run half with no log behind it
  // has no name to give (so an idle payload keeps its exact #32 shape).
  if (run.logName != null) payload.runLogName = run.logName
  return payload
}
