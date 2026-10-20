// ── The Run log directory, read the same way by both entries ────────
//
// Two readers have to answer the same two questions about the Run log directory
// with the same code: `core/check-run.ts` (the agent-facing CLI) and
// `web/server/run-log-source.ts` (the page's reader). Which `run-*.jsonl` (or
// legacy `save-wallpapers-*.jsonl`) is newest, and whether a claimed new file is
// on disk with a non-zero size. The verdict is `assessRun`'s, and the probe is
// one of its *inputs*, so a drift between the two readers would make the page
// and the command disagree about the same log — which the Console's spec says
// must be structurally impossible (spec decision 16).
//
// It lives at the `core/` root on purpose: `core/report/**` is pure and keeps the
// filesystem out of the verdict, and the pipeline must never import
// `web/server/**`.

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { FileProbe } from './report/run-log.js'
import { logRunIdOf } from './report/run-log.js'

/**
 * The newest Run log's name in `dir`, or `null` when there is none.
 *
 * The order is by the name's `runId`, never by the whole file name and never by
 * mtime. A `runId` is a zero-padded fixed-width timestamp, so comparing it
 * ascending is an exact ordering — a guess from mtimes would let a copy or a
 * touch name a different Run. The whole name cannot be the key: a plain string
 * compare ranks every legacy `save-wallpapers-…` after every new `run-…`
 * (`s` > `r`), so yesterday's legacy log would beat today's — the reason
 * `logRunIdOf` (the one name predicate, in the pure report layer) supplies the
 * key. A directory that is not there holds no Runs, which is a reading and not
 * an error.
 */
export function newestRunLogName(dir: string): string | null {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  const runLogs: { name: string; runId: string }[] = []
  for (const name of names) {
    const runId = logRunIdOf(name)
    if (runId !== null) runLogs.push({ name, runId })
  }
  runLogs.sort((a, b) => {
    if (a.runId !== b.runId) return a.runId < b.runId ? -1 : 1
    // Both names belong to the same Run (a legacy log copied beside a new one);
    // break the tie by name so the pick does not depend on the listing order.
    return a.name < b.name ? -1 : 1
  })
  return runLogs.at(-1)?.name ?? null
}

/** The newest Run log's whole path — the file `check-run` prints and reads. */
export function newestRunLogPath(dir: string): string | null {
  const name = newestRunLogName(dir)
  return name === null ? null : path.join(dir, name)
}

/**
 * The file probe `check-run` uses: a Run report's claimed new file is a
 * Wallpaper filename, named the way Download names them (ADR 0004 / the Mirror
 * check), so the probe resolves it inside the Mirror rather than re-deriving
 * anything from a URL. It counts only with a non-zero size, so an empty file
 * left by a failed write is not "the file arrived".
 */
export function createFileProbe(imagesDir: string): FileProbe {
  return filename => {
    try {
      return fs.statSync(path.join(imagesDir, filename)).size > 0
    } catch {
      return false
    }
  }
}
