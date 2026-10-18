// ── Reading the Run log directory ───────────────────────────────────
//
// The Console's knowledge of Runs is the Run log directory, never a process
// handle it happens to hold (ADR 0009): which `save-wallpapers-*.jsonl` file is
// newest, what its text says, when it was last written, and what the Gallery
// state and the Mirror say about the Run it names. A Run started from a
// terminal is therefore read exactly like one the Console started.
//
// This module is a reader, not a rule: the state decision lives in the pure
// `run-state.ts` (§6a) and the verdict in `status.ts`'s `deriveRunFacts`, which
// this hands its facts to. Nothing here writes — the Console never touches the
// Gallery state or the Mirror (spec decision 39; conventions §4).

import * as fs from 'node:fs'
import * as path from 'node:path'

import { readGalleryState } from '../gallery/gallery-state.js'
import type { FileProbe } from '../report/run-log.js'
import { runReportRecordPresent } from '../report/run-log.js'
import { newestRunLogName } from './run-report-source.js'
import type { ConsoleRunFacts } from './status.js'
import { deriveRunFacts } from './status.js'

export { ORPHAN_WINDOW_MS } from './run-state.js'

export interface RunLogSource {
  /** The newest Run log's facts — the status view's whole Run half. */
  facts(): ConsoleRunFacts
}

export interface RunLogSourceOptions {
  /** The Run log directory (`logs/`): the Console's only source about Runs. */
  logDir: string
  /** `images/.gallery-state.json` — read to match the report, never written. */
  galleryStateFile: string
  /** The Mirror (`images/`): what the file probe resolves names inside. */
  imagesDir: string
  /** Whether a Run this Console started still has a live child. */
  liveChild?: () => boolean
  /** Epoch milliseconds; injected so a test needs no clock. */
  now?: () => number
}

/**
 * The source. The log-directory listing is captured **once**, at creation —
 * that is §6a's `seenAtStartup`, and it is what separates a Run that was left
 * over from an earlier session from one that began while this Console was open.
 */
export function createRunLogSource(options: RunLogSourceOptions): RunLogSource {
  const seenAtStartup = new Set(listNames(options.logDir))
  const now = options.now ?? (() => Date.now())
  const liveChild = options.liveChild ?? (() => false)

  return {
    facts(): ConsoleRunFacts {
      // The newest Run log, by **name** — the ordering `check-run` uses
      // (`toSorted().at(-1)`), never by mtime: the filename carries the
      // timestamp, so the last name in ascending order is exact, while a copy or
      // a touch would make mtime name a different Run. #33's source owns that
      // rule (`newestRunLogName`); the page and the command must pick the same
      // file, so it is reused rather than re-implemented.
      const name = newestRunLogName(options.logDir)
      const file = name === null ? null : path.join(options.logDir, name)
      let logText: string | null = null
      let mtimeMs: number | null = null
      if (file !== null) {
        // A failed read is not "no Run ran": the file is there, its text is
        // what could not be read, and the state verdict says so.
        try {
          logText = fs.readFileSync(file, 'utf8')
        } catch {
          logText = null
        }
        try {
          mtimeMs = fs.statSync(file).mtimeMs
        } catch {
          mtimeMs = null
        }
      }
      const logName = file === null ? null : path.basename(file)

      return deriveRunFacts({
        logText,
        logName,
        // The record's presence, whatever shape it is in: an older-contract
        // report is present but unreadable, not missing (run-log.ts).
        reportPresent: logText !== null && runReportRecordPresent(logText),
        mtimeMs,
        now: now(),
        seenAtStartup: logName !== null && seenAtStartup.has(logName),
        liveChild: liveChild(),
        galleryState: readGalleryState(options.galleryStateFile),
        probe: mirrorProbe(options.imagesDir),
      })
    },
  }
}

/**
 * A log directory that is not there holds no Runs. The start-up listing is the
 * one read that has to see *every* name, not just the newest one.
 */
function listNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * `check-run`'s probe exactly (`src/check-run.ts`): the claimed new file is a
 * Wallpaper filename resolved inside the Mirror, and it counts only with a
 * non-zero size. Using the same rule is what keeps the page's verdict and the
 * command's from disagreeing about the same log.
 */
function mirrorProbe(imagesDir: string): FileProbe {
  return filename => {
    try {
      return fs.statSync(path.join(imagesDir, filename)).size > 0
    } catch {
      return false
    }
  }
}
