import { describe, expect, it } from 'vitest'

import { decideRunState, ORPHAN_WINDOW_MS, parseRunMeta } from '../../src/console/run-state.js'

const NOW = Date.UTC(2026, 9, 18, 9, 0, 0)
const FRESH = NOW - 60_000
const OLD = NOW - 791 * 3600_000

const RUN_ID = '2026-09-15T09-36-50'

function metaLine(runId = RUN_ID): string {
  return JSON.stringify({ type: 'run_meta', runId, startedAt: '2026-09-15T09:36:50.000Z' })
}

function plainLine(message = 'working'): string {
  return JSON.stringify({ level: 30, msg: message })
}

/** A record the schema refuses (an older Run contract), but a report none the less. */
function oldContractReportLine(): string {
  return JSON.stringify({ type: 'run_report', runId: RUN_ID, gallery: { officialTotal: 999 } })
}

describe('parseRunMeta', () => {
  it('reads the Run identity from the log\u2019s first record', () => {
    const text = [metaLine(), plainLine()].join('\n')

    expect(parseRunMeta(text)).toEqual({
      runId: RUN_ID,
      startedAt: '2026-09-15T09:36:50.000Z',
    })
  })

  it('refuses a log with no run_meta record', () => {
    expect(parseRunMeta(null)).toBeNull()
    expect(parseRunMeta('')).toBeNull()
    expect(parseRunMeta(plainLine())).toBeNull()
    expect(parseRunMeta('{"type":"run_meta"')).toBeNull()
  })
})

describe('decideRunState', () => {
  it('calls a complete log idle', () => {
    const text = [
      metaLine(),
      plainLine(),
      JSON.stringify({ type: 'run_report', runId: RUN_ID }),
    ].join('\n')

    const state = decideRunState({
      logText: text,
      mtimeMs: FRESH,
      now: NOW,
      seenAtStartup: false,
      liveChild: false,
    })

    expect(state).toBe('idle')
  })

  it('calls a fresh leftover present at start-up an Orphaned Run', () => {
    const state = decideRunState({
      logText: [metaLine(), plainLine()].join('\n'),
      mtimeMs: FRESH,
      now: NOW,
      seenAtStartup: true,
      liveChild: false,
    })

    expect(state).toBe('orphaned')
  })

  it('calls an unfinished log that appeared after start-up running', () => {
    // A Run started from a terminal is in flight even though no child is ours.
    const state = decideRunState({
      logText: [metaLine(), plainLine()].join('\n'),
      mtimeMs: FRESH,
      now: NOW,
      seenAtStartup: false,
      liveChild: false,
    })

    expect(state).toBe('running')
  })

  it('calls an unfinished log old beyond the window idle, not orphaned', () => {
    // The real `2026-09-15T09-36-50` is 791 h old: a lost report, not a leftover.
    const state = decideRunState({
      logText: [metaLine(), plainLine()].join('\n'),
      mtimeMs: OLD,
      now: NOW,
      seenAtStartup: true,
      liveChild: false,
    })

    expect(state).toBe('idle')
  })

  it('calls a live child running, whatever the newest log says', () => {
    const complete = [metaLine(), JSON.stringify({ type: 'run_report', runId: RUN_ID })].join('\n')

    expect(
      decideRunState({
        logText: complete,
        mtimeMs: NOW,
        now: NOW,
        seenAtStartup: true,
        liveChild: true,
      }),
    ).toBe('running')
  })

  it('does not call a shape this reader refuses a missing report', () => {
    // `runReportRecordPresent`, not `parseRunReport`: an older-contract report is
    // present but unreadable, and must not read as an unfinished Run.
    const state = decideRunState({
      logText: [metaLine(), oldContractReportLine()].join('\n'),
      mtimeMs: FRESH,
      now: NOW,
      seenAtStartup: true,
      liveChild: false,
    })

    expect(state).toBe('idle')
  })

  it('never calls a pre-run_meta log an Orphaned Run', () => {
    const state = decideRunState({
      logText: [plainLine(), plainLine()].join('\n'),
      mtimeMs: FRESH,
      now: NOW,
      seenAtStartup: true,
      liveChild: false,
    })

    expect(state).toBe('idle')
  })

  it('calls no log at all idle', () => {
    const state = decideRunState({
      logText: null,
      mtimeMs: null,
      now: NOW,
      seenAtStartup: true,
      liveChild: false,
    })

    expect(state).toBe('idle')
  })

  it('uses a 20-minute window, because discovery is legitimately silent for ~15', () => {
    expect(ORPHAN_WINDOW_MS).toBe(20 * 60_000)
  })
})
