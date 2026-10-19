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

import { readGalleryState } from '../../core/gallery/gallery-state.js'
import { runReportRecordPresent } from '../../core/report/run-log.js'
import { createFileProbe, newestRunLogName } from '../../core/run-log-file.js'
import type { ConsoleRunFacts } from './status.js'
import { deriveRunFacts } from './status.js'

export interface RunLogSource {
  /** The newest Run log's facts — the status view's whole Run half. */
  facts(): ConsoleRunFacts
  /**
   * Acknowledges the newest Run log's claim, in memory only (#36).
   *
   * The claim being acknowledged is "a Run may still be writing here". The log
   * itself is not touched: it is the audit trail (ADR 0007) and the Console
   * does not own it. Because the acknowledgement never reaches disk, a Console
   * restart re-reads the same unfinished log and reports it orphaned again —
   * the honest limitation, and the reason the page says the cleanup is offered,
   * not forced.
   */
  acknowledgeOrphan(): void
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
  /**
   * The Run log this Console's own child wrote, once that child has exited
   * (#36) — `null` before the first Run, while it lives, and when the child died
   * before writing a log. It is what lets §6a tell "the child we watched die"
   * from "a Run someone else is writing": both logs appear after start-up.
   */
  ownRunLogName?: () => string | null
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
  /**
   * The log names the page has cleaned up since this Console started. In
   * memory, deliberately: the log is the audit trail and stays on disk exactly
   * as it was written (ADR 0007).
   */
  const acknowledged = new Set<string>()
  const now = options.now ?? (() => Date.now())
  const liveChild = options.liveChild ?? (() => false)
  const ownRunLogName = options.ownRunLogName ?? (() => null)

  return {
    acknowledgeOrphan(): void {
      // The newest log is the one the page was showing: the same pick as
      // `check-run`, by name (run-report-source.ts), never by mtime.
      const name = newestRunLogName(options.logDir)
      if (name !== null) acknowledged.add(name)
    },

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
      const own = ownRunLogName()

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
        // The newest log is the one our own child wrote, and that child has
        // exited: the Console knows it is dead (§6a's own-child consequence).
        ownChildExited: own !== null && own === logName,
        acknowledged: logName !== null && acknowledged.has(logName),
        galleryState: readGalleryState(options.galleryStateFile),
        // `check-run`'s own probe (`core/run-log-file.ts`), not a copy of it:
        // the probe is one of `assessRun`'s inputs, so a drift between this
        // reader and the command would make them disagree about the same log.
        probe: createFileProbe(options.imagesDir),
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
