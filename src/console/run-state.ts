// ── The Run state decision ──────────────────────────────────────────
//
// A Run's truth is its Run log, never the handle that started it (ADR 0009), so
// the state is read from the log directory: which log is newest, whether it has
// finished, and how long ago it was written. This one pure function is
// .console-notes/00-conventions.md **§6a**, which is binding for #34 and #36 and
// exists because two tickets otherwise contradict each other: #34 says "a Run
// started from a terminal is shown as running", #36 says "an unfinished log with
// a recent modification time is an Orphaned Run". Both facts come from the same
// log signature, so the rule below is the one place the distinction is made —
// #36 fills in what follows from `orphaned`, and does not repeat the rule.
//
// A log that is unfinished and **old** is not an orphan: `2026-09-15T09-36-50`
// is 791 h old and its report was lost (ADR 0007), which is a defect in the log
// and a statement about the Run's verdict, not about it still being alive.

import { runReportRecordPresent } from '../report/run-log.js'
import type { ConsoleRunState } from './api-types.js'

/**
 * How recent an unfinished log's modification time must be to count as a Run
 * that may still be writing: 20 minutes, chosen against the 900 s `run-code`
 * discovery step, during which the log is legitimately silent for ~15 minutes.
 * A shorter window would report a live Run in its discovery phase as an orphan.
 */
export const ORPHAN_WINDOW_MS = 20 * 60_000

/** A Run's identity, from the `run_meta` record the Run log always starts with. */
export interface RunMeta {
  runId: string
  startedAt: string | null
}

/**
 * The `run_meta` record that opens a Run log, or `null` — a contract-checked
 * read of the log's first non-empty line. Identity comes from here rather than
 * from the filename, so a log whose name does not parse still names its Run;
 * `logRunIdOf` stays the fallback for a log written before `run_meta` existed.
 */
export function parseRunMeta(logText: string | null): RunMeta | null {
  if (logText === null) return null
  const firstLine = logText.split(/\r?\n/).find(line => line.trim().length > 0)
  if (firstLine === undefined) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(firstLine)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  // Narrowed with `in`/`typeof` rather than asserted: the record is foreign
  // input, and an assertion here would be the one place a bad log could lie.
  if (!('type' in parsed) || parsed.type !== 'run_meta') return null
  if (!('runId' in parsed) || typeof parsed.runId !== 'string') return null

  return {
    runId: parsed.runId,
    startedAt:
      'startedAt' in parsed && typeof parsed.startedAt === 'string' ? parsed.startedAt : null,
  }
}

/**
 * Whether the newest Run log is unfinished: it carries a `run_meta` and no
 * `run_report` record at all. `runReportRecordPresent` is used rather than
 * `parseRunReport` on purpose — a report written to an older contract is
 * present but unreadable, and calling that "no report" would make a finished
 * Run look like a leftover one.
 */
function unfinishedRun(logText: string | null): boolean {
  if (logText === null) return false
  return parseRunMeta(logText) !== null && !runReportRecordPresent(logText)
}

/** Everything the state rule is allowed to know — no clock, no filesystem. */
export interface RunStateFacts {
  /** The newest Run log's whole text, or `null` when there is no Run log. */
  logText: string | null
  /** Its `statSync().mtimeMs`, or `null` when there is no Run log. */
  mtimeMs: number | null
  /** Epoch milliseconds, injected so tests need no clock. */
  now: number
  /** Whether the log directory listing at service start-up held this log. */
  seenAtStartup: boolean
  /** Whether a Run this Console started still has a live child. */
  liveChild: boolean
  /**
   * This Console started the Run the newest log names, and its child has exited
   * since. §6a's "appeared after start-up" arm is evidence of a *terminal*
   * Run's life; it is not evidence about a child the Console watched die — the
   * consequence §6a spells out is that such a Run reads `orphaned`, because the
   * Console knows it is dead.
   */
  ownChildExited?: boolean
  /**
   * The newest log's claim was acknowledged by the page's cleanup (#36). It is
   * an acknowledgement, not a change to the log: the log stays exactly as it
   * was, and a Console restart re-reads it as orphaned again.
   */
  acknowledged?: boolean
  /** The recency window; §6a's value unless a caller overrides it. */
  orphanWindowMs?: number
}

/**
 * The state table (conventions §6a). The newest log is the one `check-run`
 * picks — name order, never mtime — so the page and the command are looking at
 * the same Run.
 */
export function decideRunState(facts: RunStateFacts): ConsoleRunState {
  const unfinished = unfinishedRun(facts.logText)
  const recent =
    facts.mtimeMs !== null &&
    facts.now - facts.mtimeMs <= (facts.orphanWindowMs ?? ORPHAN_WINDOW_MS)

  // A live child means this Console started a Run, whatever the newest log
  // currently is: a Run's first seconds have no log of their own yet.
  if (facts.liveChild) return 'running'
  // Unfinished, appeared after start-up and still being written: a Run in
  // flight that no handle of ours knows about (started from a terminal). Our
  // own Run is the exception — we watched its child exit, so it is not alive.
  if (unfinished && !facts.seenAtStartup && recent && facts.ownChildExited !== true) {
    return 'running'
  }
  // Unfinished and recent, but its claim was cleaned from the page: the state
  // is idle so another Run can start. The log still says what it always said.
  if (unfinished && recent && facts.acknowledged === true) return 'idle'
  // Unfinished and recent, but already there when the Console started, or a
  // child of ours that died: the honest reading is "a leftover, or a Run still
  // writing" — never hidden.
  if (unfinished && recent) return 'orphaned'
  return 'idle'
}
