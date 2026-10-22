// ── The Run panel's rules (#97) ─────────────────────────────────────
//
// The panel holds four lines: one verdict sentence, `ok N · failed N`, the
// figures line the wall's header shows (#94), and at most one problem line. The
// verdict sentence is the dictionary's, the figures are `lib/gallery-figures.ts`'s
// — what is left is this file's: which counts the second line carries, and which
// single problem sentence a Run is allowed to show.
//
// The problem line is one choice by priority (report missing → report unreadable
// → empty files → persistent failures → site unreachable → empty result → Mirror
// gap missing → the verdict's own causes), and every branch is pinned here: a
// regression that dropped one to the nine-row defect list #47 built would
// otherwise only show up in a browser.
//
// The ticket's other half is subtraction — no run id, no Discovery counters, no
// success rate, no defect rows, no routine notes, no `reasons:` clause. A
// template's absence is not a unit test; what *is* data is pinned here and in
// the dictionary test: the counts clause that disappears at zero failures, and
// the one line a `defect` is allowed to be.

import { describe, expect, it } from 'vitest'

import type {
  ConsoleDefects,
  ConsoleRunReport,
  ConsoleStatusPayload,
  ConsoleVerdictReasons,
} from '../../../../web/api-types.js'
import { runCountsOf, runProblemOf, runProgressOf } from '../../../../web/src/lib/run-panel.js'
import { defects, runReport } from '../../server/run-fixtures.js'

/** The verdict's own reasons, for a Run that matched and lost no claimed file. */
function reasons(over: Partial<ConsoleVerdictReasons> = {}): ConsoleVerdictReasons {
  return { stateMatchesReport: true, missingOnDisk: [], ...over }
}

/** A Run report: the fixture, with the counts and defect classes a test is about. */
function report(
  over: { ok?: number; failed?: number; defects?: Partial<ConsoleDefects> } = {},
): ConsoleRunReport {
  const base = runReport()
  return runReport({
    download: {
      ...base.download,
      ok: over.ok ?? base.download.ok,
      failed: over.failed ?? base.download.failed,
    },
    defects: defects(over.defects),
  })
}

/** The four facts a status read hands the panel's rules. */
function facts(
  over: Partial<
    Pick<ConsoleStatusPayload, 'verdict' | 'reportPresent' | 'report' | 'verdictReasons'>
  > = {},
): Pick<ConsoleStatusPayload, 'verdict' | 'reportPresent' | 'report' | 'verdictReasons'> {
  return {
    verdict: 'defect',
    reportPresent: true,
    report: report(),
    verdictReasons: reasons(),
    ...over,
  }
}

describe('runCountsOf', () => {
  it('says only what succeeded when nothing failed', () => {
    // The acceptance criterion, in full: a clean Run reads `ok 1013`, never
    // `ok 1013 · failed 0`.
    expect(runCountsOf(report({ ok: 1013, failed: 0 }))).toEqual([
      { key: 'run.counts', params: { ok: 1013 } },
    ])
  })

  it('adds the failure clause when something failed', () => {
    expect(runCountsOf(report({ ok: 1010, failed: 3 }))).toEqual([
      { key: 'run.counts', params: { ok: 1010 } },
      { key: 'run.countsFailed', params: { failed: 3 } },
    ])
  })

  it('says nothing when there is no report to count', () => {
    expect(runCountsOf(null)).toEqual([])
  })
})

describe('runProblemOf', () => {
  it('names a missing report first — the log stops before its verdict', () => {
    expect(runProblemOf(facts({ reportPresent: false, report: null }))).toEqual({
      key: 'run.reportMissing',
    })
  })

  it('tells a report it cannot read from one that is not there', () => {
    expect(runProblemOf(facts({ reportPresent: true, report: null }))).toEqual({
      key: 'run.reportUnreadable',
    })
  })

  it('names the files that downloaded empty', () => {
    expect(
      runProblemOf(facts({ report: report({ defects: { emptyFiles: ['a.jpg', 'b.jpg'] } }) })),
    ).toEqual({ key: 'defect.emptyFiles', params: { files: 'a.jpg, b.jpg' } })
  })

  it('names the Wallpapers that kept failing', () => {
    expect(runProblemOf(facts({ report: report({ defects: { persistentFailures: 4 } }) }))).toEqual(
      { key: 'defect.persistentFailures', params: { count: 4 } },
    )
  })

  it('says the site could not be reached', () => {
    expect(
      runProblemOf(facts({ report: report({ defects: { gallerySourceUnavailable: true } }) })),
    ).toEqual({ key: 'run.siteUnreachable' })
  })

  it('says the list came back empty', () => {
    expect(runProblemOf(facts({ report: report({ defects: { emptyResult: true } }) }))).toEqual({
      key: 'defect.emptyResult',
    })
  })

  it('says how many listed Wallpapers are still missing', () => {
    expect(
      runProblemOf(
        facts({ report: report({ defects: { mirrorGap: { missing: 12, extra: 0 } } }) }),
      ),
    ).toEqual({ key: 'defect.mirrorGapMissing', params: { count: 12 } })
  })

  it('falls back to the verdict’s own causes, one at a time', () => {
    // A `defect` whose report is clean still has something to say: the Gallery
    // state that does not match, or the claimed files the probe rejected.
    expect(runProblemOf(facts({ verdictReasons: reasons({ stateMatchesReport: false }) }))).toEqual(
      { key: 'run.cause.stateNamesAnotherRun' },
    )
    expect(runProblemOf(facts({ verdictReasons: reasons({ stateMatchesReport: null }) }))).toEqual({
      key: 'run.cause.stateUnreadable',
    })
    expect(
      runProblemOf(facts({ verdictReasons: reasons({ missingOnDisk: ['1024_abc.jpg'] }) })),
    ).toEqual({ key: 'run.cause.missingOnDisk', params: { files: '1024_abc.jpg' } })
  })

  it('chooses one line by the spec’s priority, never a list', () => {
    // Every nameable fact at once, the state mismatch included; each step drops
    // the fact the line before it was chosen from, so the order is the assertion.
    const everyDefect = {
      emptyFiles: ['e.jpg'],
      persistentFailures: 2,
      gallerySourceUnavailable: true,
      emptyResult: true,
      mirrorGap: { missing: 5, extra: 0 },
    }
    const broken = reasons({ stateMatchesReport: false, missingOnDisk: ['m.jpg'] })

    const cases: [
      Partial<ConsoleDefects>,
      { key: string; params?: Record<string, number | string> },
    ][] = [
      [everyDefect, { key: 'defect.emptyFiles', params: { files: 'e.jpg' } }],
      [
        { ...everyDefect, emptyFiles: [] },
        { key: 'defect.persistentFailures', params: { count: 2 } },
      ],
      [{ ...everyDefect, emptyFiles: [], persistentFailures: 0 }, { key: 'run.siteUnreachable' }],
      [
        {
          ...everyDefect,
          emptyFiles: [],
          persistentFailures: 0,
          gallerySourceUnavailable: false,
        },
        { key: 'defect.emptyResult' },
      ],
      [
        {
          ...everyDefect,
          emptyFiles: [],
          persistentFailures: 0,
          gallerySourceUnavailable: false,
          emptyResult: false,
        },
        { key: 'defect.mirrorGapMissing', params: { count: 5 } },
      ],
      [
        {
          ...everyDefect,
          emptyFiles: [],
          persistentFailures: 0,
          gallerySourceUnavailable: false,
          emptyResult: false,
          mirrorGap: { missing: 0, extra: 0 },
        },
        { key: 'run.cause.stateNamesAnotherRun' },
      ],
    ]

    for (const [classes, expected] of cases) {
      expect(
        runProblemOf(facts({ report: report({ defects: classes }), verdictReasons: broken })),
      ).toEqual(expected)
    }
  })

  it('shows nothing for a clean or an explained Run', () => {
    expect(runProblemOf(facts({ verdict: 'clean', report: report() }))).toBeNull()
    // A routine extra is recorded, not failed: the verdict says so and the panel
    // adds no problem line for it.
    expect(
      runProblemOf(
        facts({
          verdict: 'explained',
          report: report({ defects: { mirrorGap: { missing: 0, extra: 12 } } }),
        }),
      ),
    ).toBeNull()
  })
})

describe('runProgressOf', () => {
  it('says how many of the list are downloaded, both counts named', () => {
    expect(runProgressOf(300, 1013)).toEqual({
      key: 'wall.progress',
      params: { done: 300, total: 1013 },
    })
  })

  it('still names the downloaded count when the list is unread', () => {
    expect(runProgressOf(300, null)).toEqual({
      key: 'wall.progressUnknownTotal',
      params: { done: 300 },
    })
  })
})
