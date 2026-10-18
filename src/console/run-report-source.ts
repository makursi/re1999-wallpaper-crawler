// ── The newest Run's report, read the way `check-run` reads it ───────
//
// The Console needs one number that only a Run report carries: the newest
// Run's `gallery.newSinceLastRun`. It is read here, from the Run log directory
// alone (spec decision 7), with the same two facts `check-run` uses — the same
// file (`readdirSync` filtered to `save-wallpapers-*.jsonl`, sorted by name and
// last, **never** by mtime: src/check-run.ts:31-43) and the same parser
// (`parseRunReport`, never a hand-rolled `JSON.parse`, so the report schema's
// `null`-coherence refine still applies).
//
// Recomputing this number from `images/.gallery-state.json` gives 0 — the Run
// that wrote the state had already unioned those ids in (§4a) — which is why
// it is read rather than derived.

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { RunReport } from '../report/report.js'
import { parseRunReport } from '../report/run-log.js'

/**
 * The newest Run log's file name, by lexicographic name order.
 *
 * `toSorted()` with no comparator is a string compare, which is correct here
 * only because `runId` is a zero-padded fixed-width timestamp — the same
 * assumption `check-run` makes.
 */
export function newestRunLogName(logDir: string): string | null {
  try {
    const names = fs
      .readdirSync(logDir)
      .filter(name => name.startsWith('save-wallpapers-') && name.endsWith('.jsonl'))
    return names.toSorted().at(-1) ?? null
  } catch {
    // No log directory at all is "no Run has run here", not an error.
    return null
  }
}

/**
 * The newest Run's report, verbatim, or `null` when there is no readable one.
 *
 * `null` covers both "no Run log" and "the newest log has no report this
 * schema accepts" — the same overloading `parseRunReport` documents, which is
 * why callers that need the distinction must ask `runReportRecordPresent`
 * separately (the status half of the Console is #34's).
 */
export function readNewestRunReport(logDir: string): RunReport | null {
  const name = newestRunLogName(logDir)
  if (name === null) return null

  let text: string
  try {
    text = fs.readFileSync(path.join(logDir, name), 'utf8')
  } catch {
    // The log we picked vanished or is unreadable: not a number to publish.
    return null
  }
  return parseRunReport(text)
}
