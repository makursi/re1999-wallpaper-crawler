// ── The Run state as a lifetime (#36) ───────────────────────────────
//
// tests/console/run-state.test.ts pins #34's table. This file pins what #36
// adds on top of it, and re-walks the whole table so the two tickets' facts are
// read together: conventions §6a is one rule in one function, never a second
// state rule somewhere else.

import { describe, expect, it } from 'vitest'

import { decideRunState } from '../../src/console/run-state.js'
import type { RunStateFacts } from '../../src/console/run-state.js'
import { plainLine, runLog, runReport } from './run-fixtures.js'

const NOW = Date.UTC(2026, 9, 18, 9, 0, 0)
const FRESH = NOW - 60_000
/** The real `2026-09-15T09-36-50` is 791 h old: a lost report, not a leftover. */
const OLD = NOW - 791 * 3600_000

/** A log with a `run_meta` and no `run_report`: the orphan signature. */
function unfinished(): string {
  return runLog(plainLine('5. Downloading images...'))
}

/** A log whose closing `run_report` record is there. */
function finished(): string {
  return runLog(JSON.stringify(runReport()))
}

function stateOf(over: Partial<RunStateFacts> = {}): string {
  return decideRunState({
    logText: unfinished(),
    mtimeMs: FRESH,
    now: NOW,
    seenAtStartup: false,
    liveChild: false,
    ...over,
  })
}

describe('the Run state table, read as lifetimes', () => {
  it('calls an unfinished log present at start-up orphaned', () => {
    // The leftover ADR 0009 names: a log from an earlier session, still recent.
    expect(stateOf({ seenAtStartup: true })).toBe('orphaned')
  })

  it('calls the same unfinished log idle once it is old', () => {
    // Old is a lost Run report — a defect in the log, which the verdict carries
    // — not a leftover Run that needs cleaning before another can start.
    expect(stateOf({ seenAtStartup: true, mtimeMs: OLD })).toBe('idle')
  })

  it('calls an unfinished log that appeared after start-up running', () => {
    // A Run started from a terminal: its log was not in the start-up listing,
    // so the Console has no handle for it and the recent write is the evidence.
    expect(stateOf({ seenAtStartup: false })).toBe('running')
  })

  it('calls a live child running, whatever the log says', () => {
    expect(stateOf({ logText: finished(), liveChild: true })).toBe('running')
  })

  it('calls a finished log idle', () => {
    expect(stateOf({ logText: finished(), seenAtStartup: true })).toBe('idle')
  })

  it('does not call a report this reader refuses missing', () => {
    const olderContract = JSON.stringify({
      type: 'run_report',
      runId: '2026-10-18T01-03-31',
      gallery: { officialTotal: 999 },
    })

    // `runReportRecordPresent`, not `parseRunReport`: present but unreadable is
    // not the same statement as absent.
    expect(stateOf({ logText: runLog(olderContract), seenAtStartup: true })).toBe('idle')
  })

  it('calls the Run this Console started orphaned once its child has exited', () => {
    // The Console *knows* that child is dead, so the "appeared after start-up"
    // arm must not keep calling it running (conventions §6a).
    expect(stateOf({ seenAtStartup: false, ownChildExited: true })).toBe('orphaned')
  })

  it('still calls an unfinished log running while the Console child lives', () => {
    expect(stateOf({ seenAtStartup: false, ownChildExited: true, liveChild: true })).toBe('running')
  })

  it('calls a cleaned-up orphan idle', () => {
    // Cleanup acknowledges the log's claim in memory; the log itself stays.
    expect(stateOf({ seenAtStartup: true, acknowledged: true })).toBe('idle')
  })

  it('does not let an acknowledgement hide a live Run', () => {
    expect(stateOf({ seenAtStartup: true, acknowledged: true, liveChild: true })).toBe('running')
  })
})
