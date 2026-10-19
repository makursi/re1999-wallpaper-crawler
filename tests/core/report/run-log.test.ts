import * as os from 'node:os'

import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import type { GalleryState } from '../../../core/gallery/gallery-state.js'
import type { RunReport } from '../../../core/report/report.js'
import type { RunDefects, FileProbe } from '../../../core/report/run-log.js'
import {
  assessRun,
  logRunIdOf,
  parseRunReport,
  runReportRecordPresent,
} from '../../../core/report/run-log.js'

const EOL = os.EOL

const RUN_ID = '2026-10-18T01-03-31'
const NEW_FILES = ['1024_abc.jpg', '1023_def.png']

function defects(over: Partial<RunDefects> = {}): RunDefects {
  return {
    discoveryLeak: { count: 0, urls: [] },
    nonConverged: false,
    emptyResult: false,
    persistentFailures: 0,
    emptyFiles: [],
    siteAssetFalsePositive: { count: 0, urls: [] },
    gallerySourceUnavailable: false,
    mirrorGap: { missing: 0, extra: 0 },
    ...over,
  }
}

function metaLine(runId: string): string {
  return JSON.stringify({ type: 'run_meta', runId, msg: 'run started' })
}

function reportLine(record: RunReport): string {
  return JSON.stringify(record)
}

/** A Run report record, as `core/main.ts` writes it — the JSONL line without the pino envelope. */
function report(over: Partial<RunReport> = {}): RunReport {
  return {
    type: 'run_report',
    runId: RUN_ID,
    startedAt: '2026-10-18T01:03:31.856Z',
    finishedAt: '2026-10-18T01:07:09.045Z',
    durationMs: 217189,
    discovery: {
      converged: true,
      stableRounds: 6,
      totalIdleSec: 60,
      networkCount: 78,
      domCount: 75,
      combinedCount: 79,
      thumbnailsClicked: 15,
      discoveryDurationMs: 173592,
      coverage: 0.0446,
    },
    download: {
      total: 1,
      ok: 1,
      skipped: 0,
      failed: 0,
      successRate: 1,
      retryRescued: 0,
      retryTotal: 0,
      rescueRate: 0,
      emptyFiles: 0,
      emptyFilenames: [],
      persistentFailures: 0,
      totalBytes: 100,
      avgDownloadMs: 1,
      statusHistogram: { 200: 1 },
      failureGroups: [],
      failures: [],
    },
    gallery: {
      officialTotal: 1010,
      newSinceLastRun: NEW_FILES.length,
      newFiles: NEW_FILES,
      firstRun: false,
      mirror: {
        missingFromDisk: { count: 0, files: [] },
        extraOnDisk: { count: 0, files: [] },
      },
    },
    siteAssets: { count: 1, urls: ['https://re.bluepoch.com/home/detail.html'] },
    defects: defects(),
    failures: [],
    ...over,
  }
}

function stateOf(over: Partial<GalleryState> = {}): GalleryState {
  return {
    version: 1,
    ids: [1012, 1013],
    updatedAt: '2026-10-18T01:07:09.045Z',
    runId: RUN_ID,
    ...over,
  }
}

/** A report for a Run whose Gallery list call failed: both checks are `null`. */
function unchecked(over: Partial<RunReport> = {}): RunReport {
  return report({
    gallery: {
      officialTotal: null,
      newSinceLastRun: null,
      newFiles: [],
      firstRun: false,
      mirror: null,
    },
    defects: defects({ mirrorGap: null, siteAssetFalsePositive: null }),
    ...over,
  })
}

function present(): true {
  return true
}

describe('parseRunReport', () => {
  it('finds the Run report among the log records, wherever it sits', () => {
    const log = [
      metaLine(RUN_ID),
      JSON.stringify({ level: 30, msg: '0. Preparing fresh browser session...' }),
      JSON.stringify({ level: 30, msg: '   Session cleared.' }),
      reportLine(report()),
      JSON.stringify({ level: 30, msg: 'done' }),
    ].join(EOL)

    const parsed = parseRunReport(log)
    expect(parsed).not.toBeNull()
    expect(parsed?.runId).toBe(RUN_ID)
    expect(parsed?.type).toBe('run_report')
    // The whole record, not a re-summary: the verdict cannot disagree with the log.
    expect(parsed?.defects).toEqual(defects())
    expect(parsed?.gallery.newFiles).toEqual(NEW_FILES)
  })

  it('refuses a log that stops before its Run report', () => {
    const log = [
      metaLine(RUN_ID),
      JSON.stringify({ level: 30, msg: '5. Downloading images...' }),
    ].join(EOL)

    expect(parseRunReport(log)).toBeNull()
  })

  it('refuses a truncated final line rather than throwing', () => {
    const log = [metaLine(RUN_ID), '{"level":30,"msg":"partial line that never fin'].join(EOL)

    expect(parseRunReport(log)).toBeNull()
  })

  it('refuses empty input and a run_report record it cannot trust', () => {
    expect(parseRunReport('')).toBeNull()
    expect(parseRunReport('not a log at all')).toBeNull()

    // A run_meta or an ordinary record is not a report.
    expect(parseRunReport([metaLine(RUN_ID), '{"level":30,"msg":"hi"}'].join(EOL))).toBeNull()

    // A record that claims to be a report but is missing its metrics is refused,
    // the way the Gallery list parser refuses an untrustworthy payload.
    const broken = { ...report(), download: undefined }
    expect(parseRunReport(JSON.stringify(broken))).toBeNull()
  })
})

describe('logRunIdOf', () => {
  it('reads the Run out of a Run log filename', () => {
    expect(logRunIdOf('save-wallpapers-2026-10-18T01-03-31.jsonl')).toBe('2026-10-18T01-03-31')
  })

  it('returns null for a name that is not a Run log', () => {
    expect(logRunIdOf('save-wallpapers.jsonl')).toBeNull()
    expect(logRunIdOf('notes.jsonl')).toBeNull()
    expect(logRunIdOf('save-wallpapers-2026-10-18T01-03-31.jsonl.bak')).toBeNull()
  })
})

describe('runReportRecordPresent', () => {
  it('is true when the log carries a Run report this command can read', () => {
    expect(runReportRecordPresent([metaLine(RUN_ID), reportLine(report())].join(EOL))).toBe(true)
  })

  it('is true for a Run report written to an older contract', () => {
    // The shape `logs/` holds from before 2026-09-15: no `discovery.coverage`,
    // the pre-ADR-0006 gallery block, and only five defect classes. The schema
    // refuses it, so the record's mere presence is what stops the CLI reporting
    // a report that is there as a missing one.
    const older = {
      ...report(),
      discovery: { ...report().discovery, coverage: undefined },
      gallery: {
        officialTotal: 999,
        previousOfficialTotal: 998,
        newSinceLastRun: 1,
        firstRun: false,
      },
      defects: {
        discoveryLeak: { count: 0, urls: [] },
        nonConverged: false,
        emptyResult: false,
        persistentFailures: 0,
        emptyFiles: [],
      },
    }
    const text = [metaLine(RUN_ID), JSON.stringify(older)].join(EOL)

    expect(parseRunReport(text)).toBeNull()
    expect(runReportRecordPresent(text)).toBe(true)
  })

  it('is false when no line claims to be a Run report', () => {
    const text = [metaLine(RUN_ID), '{"level":30,"msg":"hi"}'].join(EOL)

    expect(runReportRecordPresent(text)).toBe(false)
  })

  it('is false when the only candidate line is unreadable', () => {
    expect(runReportRecordPresent('{"type":"run_report","runId":')).toBe(false)
  })
})

describe('assessRun', () => {
  it('calls a clean Run clean', () => {
    const verdict = assessRun(report(), stateOf(), present)

    expect(verdict.verdict).toBe('clean')
    expect(verdict.runId).toBe(RUN_ID)
    expect(verdict.reportPresent).toBe(true)
    expect(verdict.stateMatchesReport).toBe(true)
    expect(verdict.missingOnDisk).toEqual([])
    expect(verdict.explained).toEqual([])
  })

  it('names a missing Run report a defect rather than a failed Run', () => {
    const verdict = assessRun(null, stateOf(), present, RUN_ID)

    expect(verdict.verdict).toBe('defect')
    expect(verdict.runId).toBeNull()
    expect(verdict.reportPresent).toBe(false)
    // The Gallery state still answers "did the Run finish?" — the fact that
    // separates a lost report from a Run that never got there.
    expect(verdict.stateMatchesReport).toBe(true)
    expect(verdict.defects).toBeNull()
    expect(verdict.explained).toEqual([])
  })

  it('still tells a lost report from a Run that never got there', () => {
    const lost = assessRun(null, stateOf(), present, RUN_ID)
    expect(lost.stateMatchesReport).toBe(true)

    const neverFinished = assessRun(null, stateOf({ runId: 'older-run' }), present, RUN_ID)
    expect(neverFinished.stateMatchesReport).toBe(false)

    const noState = assessRun(null, null, present, RUN_ID)
    expect(noState.stateMatchesReport).toBeNull()
  })

  it('cannot claim the Run finished when the log name is unreadable', () => {
    // No log Run to compare against, so the state is not evidence either way.
    expect(assessRun(null, stateOf(), present).stateMatchesReport).toBe(false)
  })

  it('checks the claimed new files through the probe', () => {
    const rejected = '1023_def.png'
    const probe: Mock<FileProbe> = vi.fn<FileProbe>(
      (filename: string): boolean => filename !== rejected,
    )

    const verdict = assessRun(report(), stateOf(), probe)

    // Asserted through what the verdict decides, not how it consults the probe.
    expect(verdict.missingOnDisk).toEqual([rejected])
    expect(verdict.verdict).toBe('defect')
  })

  it('distinguishes a mismatched Gallery state from an unreadable one', () => {
    const mismatched = assessRun(report(), stateOf({ runId: 'some-other-run' }), present)
    expect(mismatched.stateMatchesReport).toBe(false)
    expect(mismatched.verdict).toBe('defect')

    const unreadable = assessRun(report(), null, present)
    expect(unreadable.stateMatchesReport).toBeNull()
    expect(unreadable.verdict).toBe('defect')
  })

  it('explains a discovery leak wholly accounted for by the Site asset list', () => {
    const leak = 'https://re.bluepoch.com/home/detail.html'
    const verdict = assessRun(
      report({
        siteAssets: { count: 2, urls: [leak, 'https://hm.baidu.com/hm.gif?rnd=1'] },
        defects: defects({ discoveryLeak: { count: 1, urls: [leak] } }),
      }),
      stateOf(),
      present,
    )

    expect(verdict.verdict).toBe('explained')
    expect(verdict.explained).toContain(`discoveryLeak: ${leak}`)
  })

  it('treats a leak URL absent from the Site asset list as a defect', () => {
    const verdict = assessRun(
      report({
        defects: defects({
          discoveryLeak: { count: 1, urls: ['https://cdn/PICTURE/20260907/1012.jpg'] },
        }),
      }),
      stateOf(),
      present,
    )

    expect(verdict.verdict).toBe('defect')
    expect(verdict.explained).toEqual([])
  })

  it('treats a leak whose URLs are only partly in the Site asset list as a defect', () => {
    const accounted = 'https://re.bluepoch.com/home/detail.html'
    const verdict = assessRun(
      report({
        siteAssets: { count: 1, urls: [accounted] },
        defects: defects({
          discoveryLeak: { count: 2, urls: [accounted, 'https://cdn/PICTURE/20260907/1012.jpg'] },
        }),
      }),
      stateOf(),
      present,
    )

    expect(verdict.verdict).toBe('defect')
    expect(verdict.explained).toEqual([])
  })

  it('explains extra files on the Mirror and defects on missing ones', () => {
    const extra = assessRun(
      report({ defects: defects({ mirrorGap: { missing: 0, extra: 3 } }) }),
      stateOf(),
      present,
    )
    expect(extra.verdict).toBe('explained')
    expect(extra.explained).toContain('mirrorGap: extra 3')

    const missing = assessRun(
      report({ defects: defects({ mirrorGap: { missing: 2, extra: 0 } }) }),
      stateOf(),
      present,
    )
    expect(missing.verdict).toBe('defect')
    expect(missing.explained).toEqual([])
  })

  it('never lets a null mirror gap or a null Site asset check read as clean', () => {
    const verdict = assessRun(unchecked(), stateOf(), present)

    expect(verdict.defects?.mirrorGap).toBeNull()
    expect(verdict.defects?.siteAssetFalsePositive).toBeNull()
    // Not checked is not the same as checked-and-clean.
    expect(verdict.verdict).toBe('defect')
  })

  it('refuses a report whose Mirror gap and Site asset check disagree', () => {
    // One of the pair `null` and the other not is a record this repo never
    // writes; accepting it could let a half-checked Run read clean.
    expect(parseRunReport(reportLine(report({ defects: defects({ mirrorGap: null }) })))).toBeNull()
  })

  it.each<[string, RunDefects]>([
    ['nonConverged', defects({ nonConverged: true })],
    ['emptyResult', defects({ emptyResult: true })],
    ['persistentFailures', defects({ persistentFailures: 1 })],
    ['emptyFiles', defects({ emptyFiles: ['a.jpg'] })],
    [
      'siteAssetFalsePositive',
      defects({ siteAssetFalsePositive: { count: 1, urls: ['https://cdn/x.jpg'] } }),
    ],
    ['gallerySourceUnavailable', defects({ gallerySourceUnavailable: true })],
  ])('calls %s a defect on its own', (_name, reported) => {
    const verdict = assessRun(report({ defects: reported }), stateOf(), present)

    expect(verdict.verdict).toBe('defect')
    expect(verdict.explained).toEqual([])
  })

  it('reports the Run report\u2019s defect block verbatim', () => {
    const reported = defects({
      discoveryLeak: { count: 1, urls: ['https://re.bluepoch.com/home/detail.html'] },
      persistentFailures: 2,
      mirrorGap: { missing: 1, extra: 3 },
    })
    const verdict = assessRun(
      report({ defects: reported, siteAssets: { count: 0, urls: [] } }),
      stateOf(),
      present,
    )

    expect(verdict.defects).toBe(reported)
  })

  it('reads a Run with no Gallery numbers as a defect, not as zero', () => {
    const verdict = assessRun(unchecked(), stateOf(), present)

    expect(verdict.verdict).toBe('defect')
    expect(verdict.explained).toEqual([])
  })

  it('names the routine classes it detected without fewer defects reading as clean', () => {
    const leak = 'https://re.bluepoch.com/home/detail.html'
    const verdict = assessRun(
      report({
        siteAssets: { count: 1, urls: [leak] },
        defects: defects({
          discoveryLeak: { count: 1, urls: [leak] },
          mirrorGap: { missing: 0, extra: 3 },
          emptyResult: true,
        }),
      }),
      stateOf(),
      present,
    )

    expect(verdict.verdict).toBe('defect')
    expect(verdict.explained).toEqual([`discoveryLeak: ${leak}`, 'mirrorGap: extra 3'])
  })
})
