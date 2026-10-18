// ── The Run log directory, read the same way by both entries ────────
//
// Two readers have to answer the same two questions about the Run log directory
// with the same code: `src/check-run.ts` (the agent-facing CLI) and
// `src/console/run-log-source.ts` (the page's reader). Which
// `save-wallpapers-*.jsonl` is newest, and whether a claimed new file is on
// disk with a non-zero size. The verdict is `assessRun`'s, and the probe is one
// of its *inputs*, so a drift between the two readers would make the page and
// the command disagree about the same log — which the Console's spec says must
// be structurally impossible (spec decision 16).
//
// It lives at the `src/` root on purpose: `src/report/**` is pure and keeps the
// filesystem out of the verdict, and the pipeline must never import
// `src/console/**`.

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { FileProbe } from './report/run-log.js'

/**
 * The newest Run log's name in `dir`, or `null` when there is none.
 *
 * `toSorted()` with no comparator is a string compare, which is correct here
 * only because a `runId` is a zero-padded fixed-width timestamp: the filename
 * carries it, so the last name in ascending order is the newest Run — an exact
 * ordering, never a guess from mtimes. A directory that is not there holds no
 * Runs, which is a reading and not an error.
 */
export function newestRunLogName(dir: string): string | null {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  const runLogs = names.filter(
    name => name.startsWith('save-wallpapers-') && name.endsWith('.jsonl'),
  )
  return runLogs.toSorted().at(-1) ?? null
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
