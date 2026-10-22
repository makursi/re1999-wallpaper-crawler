import { describe, expect, it } from 'vitest'

import type { RunReport } from '../../../core/report/report.js'
import { assessRun, logRunIdOf, parseRunReport } from '../../../core/report/run-log.js'
import type { ConsoleStatusPayload } from '../../../web/api-types.js'
import type { ConsoleRunLogFacts } from '../../../web/server/status.js'
import { buildStatus, deriveRunFacts } from '../../../web/server/status.js'
import type { UpdateNotice } from '../../../web/server/update-check.js'
import {
  defects,
  galleryState,
  LOG_NAME,
  NEW_FILES,
  packageVersion,
  plainLine,
  runLog,
  runReport,
  RUN_ID,
  STARTED_AT,
} from './run-fixtures.js'

/** The raw Run facts plus the facts the assembly takes from the service. */
type RawStatusFacts = ConsoleRunLogFacts & {
  version: string | null
  update: UpdateNotice | null
  mirrorCount: number
  officialTotal: number | null
  listAvailable: boolean
  runConfigAvailable: boolean
}

/**
 * The whole status view in one call: the Run half derived purely from the raw
 * facts, then assembled with the Mirror's count, the Gallery list's answer and
 * whether a Run can be configured.
 * Defaults are a finished, healthy Run with the list read.
 */
function statusOf(over: Partial<RawStatusFacts> = {}): ConsoleStatusPayload {
  const {
    logText,
    version = packageVersion(),
    update = null,
    mirrorCount = 1013,
    officialTotal = 1010,
    listAvailable = true,
    runConfigAvailable = true,
    ...run
  } = over
  return buildStatus({
    version,
    update,
    run: deriveRunFacts({
      logName: LOG_NAME,
      reportPresent: true,
      mtimeMs: 1_000_000,
      now: 1_000_000,
      seenAtStartup: true,
      liveChild: false,
      galleryState: galleryState(),
      probe: () => true,
      ...run,
      logText: logText === undefined ? runLog(JSON.stringify(runReport())) : logText,
    }),
    mirrorCount,
    gallery: { officialTotal, listAvailable },
    runConfigAvailable,
  })
}

describe('deriveStatus', () => {
  it.each<[string, RunReport]>([
    ['clean', runReport()],
    ['explained', runReport({ defects: defects({ mirrorGap: { missing: 0, extra: 3 } }) })],
    ['defect', runReport({ defects: defects({ nonConverged: true }) })],
  ])('reports a %s Run exactly as assessRun does', (expected, record) => {
    const logText = runLog(JSON.stringify(record))

    // The independent source of truth: what `check-run` itself would print.
    const command = assessRun(
      parseRunReport(logText),
      galleryState(),
      () => true,
      logRunIdOf(LOG_NAME),
    )
    const status = statusOf({ logText })

    expect(status.verdict).toBe(expected)
    expect(status.verdict).toBe(command.verdict)
    expect(status.defects).toEqual(command.defects)
    // The verdict's own reasons travel with it: the same two `check-run` prints
    // beside the report's defects, so a `defect` the report's defect block does
    // not explain still reaches the page with its cause (#34 story 11). The
    // routine classes behind an `explained` verdict stay in core: the page says
    // the verdict sentence and carries no per-kind detail (#97).
    expect(status.verdictReasons).toEqual({
      stateMatchesReport: command.stateMatchesReport,
      missingOnDisk: command.missingOnDisk,
    })
  })

  it('reports claimed new files the Mirror does not hold as a defect, with that cause', () => {
    const logText = runLog(JSON.stringify(runReport()))

    const status = statusOf({
      logText,
      probe: filename => !NEW_FILES.includes(filename),
    })

    // `check-run`'s probe semantics: a claimed new file that is absent or empty
    // makes the Run a defect, because that is what the command would say.
    const command = assessRun(
      parseRunReport(logText),
      galleryState(),
      () => false,
      logRunIdOf(LOG_NAME),
    )
    expect(status.verdict).toBe('defect')
    expect(status.verdict).toBe(command.verdict)
    // The report's defect block is entirely clean; the missing files are the
    // whole reason, and they reach the page instead of an unexplained verdict.
    expect(status.defects).toEqual(defects())
    expect(status.verdictReasons).toEqual({
      stateMatchesReport: true,
      missingOnDisk: NEW_FILES,
    })
  })

  it('carries a Gallery state that names another Run as the verdict’s cause', () => {
    const status = statusOf({
      logText: runLog(JSON.stringify(runReport())),
      galleryState: galleryState({ runId: '2026-10-17T00-00-00' }),
    })

    // Same shape as above, the other cause the report cannot carry: clean
    // defects, and `defect` because the state is not this Run's.
    expect(status.defects).toEqual(defects())
    expect(status.verdict).toBe('defect')
    expect(status.verdictReasons).toEqual({
      stateMatchesReport: false,
      missingOnDisk: [],
    })
  })

  it('reports a log that stops before its run_report as a defect in the log', () => {
    const logText = runLog('{"level":30,"msg":"5. Downloading images..."}')

    const status = statusOf({ logText, reportPresent: false })

    // Neither "clean" nor "the Run failed": the log is what is defective.
    expect(status.verdict).toBe('defect')
    expect(status.report).toBeNull()
    expect(status.reportPresent).toBe(false)
  })

  it('does not call a Run report it cannot read a missing one', () => {
    const older = JSON.stringify({
      type: 'run_report',
      runId: RUN_ID,
      gallery: { officialTotal: 999, previousOfficialTotal: 998 },
    })

    const status = statusOf({ logText: runLog(older) })

    expect(status.reportPresent).toBe(true)
    expect(status.report).toBeNull()
    // Unreadable is still a defect — but saying the report is missing would be a
    // false statement about the log (runReportRecordPresent exists for this).
    expect(status.verdict).toBe('defect')
  })

  it('carries the newest Run report and its defect block verbatim', () => {
    const record = runReport({
      defects: defects({ mirrorGap: { missing: 1, extra: 3 }, persistentFailures: 2 }),
    })

    const status = statusOf({ logText: runLog(JSON.stringify(record)) })

    // The Gallery numbers, Download numbers and defects the page shows together.
    expect(status.report).toEqual(record)
    expect(status.report?.download).toEqual(record.download)
    expect(status.report?.gallery).toEqual(record.gallery)
    expect(status.defects).toEqual(record.defects)
  })

  it('takes the Run identity from run_meta rather than the log file name', () => {
    const status = statusOf({
      logText: runLog(JSON.stringify(runReport())),
      logName: 'save-wallpapers-2020-01-01T00-00-00.jsonl',
    })

    expect(status.runId).toBe(RUN_ID)
    expect(status.startedAt).toBe(STARTED_AT)
  })

  it('expresses progress as the Mirror count against the Gallery total', () => {
    // The log holds only `run_meta` and the closing `run_report`: nothing here
    // may need a per-file record in between (spec decision 8).
    const status = statusOf({ logText: runLog(JSON.stringify(runReport())) })

    expect(status.mirrorCount).toBe(1013)
    expect(status.officialTotal).toBe(1010)
    expect(status.listAvailable).toBe(true)
  })

  it('withholds the verdict while a Run is in flight', () => {
    const logText = runLog(plainLine())

    const status = statusOf({
      logText,
      reportPresent: false,
      mtimeMs: 999_000,
      now: 1_000_000,
      seenAtStartup: false,
    })

    expect(status.state).toBe('running')
    expect(status.verdict).toBeNull()
    expect(status.defects).toBeNull()
    // The reasons belong to the verdict, so they are withheld with it.
    expect(status.verdictReasons).toBeNull()
    expect(status.report).toBeNull()
  })

  it('reports no Run at all as idle with nothing to show', () => {
    const status = statusOf({ logText: null, logName: null, reportPresent: false, mtimeMs: null })

    expect(status.state).toBe('idle')
    expect(status.runId).toBeNull()
    expect(status.startedAt).toBeNull()
    expect(status.verdict).toBe('defect')
  })

  it('says the list was not read rather than that nothing is missing', () => {
    const status = statusOf({ officialTotal: null, listAvailable: false })

    expect(status.officialTotal).toBeNull()
    expect(status.listAvailable).toBe(false)
  })

  it('carries whether a Run’s configuration is available, with the list left unread', () => {
    // No usable `.env`: the service reports it, and the Gallery half degrades to
    // the contract's "not read" — `null`, never `0`, and never an empty list.
    const status = statusOf({
      runConfigAvailable: false,
      officialTotal: null,
      listAvailable: false,
    })

    expect(status.runConfigAvailable).toBe(false)
    expect(status.officialTotal).toBeNull()
    expect(status.listAvailable).toBe(false)
    // The Run half keeps its exact shape beside the new fact.
    expect(status.report).not.toBeNull()
    expect(status.verdict).toBe('clean')
  })

  it('carries the same fact as true when the configuration is usable', () => {
    const status = statusOf({ runConfigAvailable: true, officialTotal: 1010, listAvailable: true })

    expect(status.runConfigAvailable).toBe(true)
    expect(status.officialTotal).toBe(1010)
    expect(status.listAvailable).toBe(true)
  })
})

describe('the update notice', () => {
  it('carries the boot’s notice verbatim, and none when there is nothing to say', () => {
    // #81: the decision is the update module's; the assembly moves the answer
    // through untouched, so the page can never read a version the check did not
    // name.
    const notice = { version: '1.2.3', releasesUrl: 'https://github.com/o/r/releases' }

    expect(statusOf({ update: notice }).updateNotice).toEqual(notice)
    expect(statusOf({ update: null }).updateNotice).toBeNull()
  })
})
