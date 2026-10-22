// ── The wall's own three questions (#83) ────────────────────────────
//
// The first-run wall has to explain itself: what the reader can do now (start),
// what is happening (progress), and what is left (resume after an interruption).
// Which of those the wall carries is a rule, not a template detail, so it is a
// pure function here and the page only renders the answer.
//
// The resume half is the Mirror gap's `missing` count (#94), the same number the
// header prints and the same one the Run report computes. It is deliberately
// NOT "Gallery total minus Mirror count": a Mirror holding three retired files
// would then hide twelve missing Wallpapers.

import { describe, expect, it } from 'vitest'

import type { WallFacts } from '../../../../web/src/lib/wall-state.js'
import { remainingOf, wallBandOf } from '../../../../web/src/lib/wall-state.js'

/** The wall's facts, with only what a case is about spelled out. */
function facts(overrides: Partial<WallFacts> = {}): WallFacts {
  return {
    wallpaperCount: 300,
    downloaded: 300,
    officialTotal: 1010,
    missing: 710,
    liveMirrorCount: 300,
    running: false,
    orphaned: false,
    ...overrides,
  }
}

describe('the wall’s band', () => {
  it('offers the start entry point on an empty wall', () => {
    // A fresh install: nothing in the Mirror, the list read, 1010 to fetch.
    expect(
      wallBandOf(facts({ wallpaperCount: 0, downloaded: 0, liveMirrorCount: 0, missing: 1010 })),
    ).toBe('empty')
  })

  it('offers the start entry point even before the list was read', () => {
    // The reader still needs the one action that matters while the first read
    // is failing; the failure line above explains the rest.
    expect(
      wallBandOf(
        facts({
          wallpaperCount: 0,
          downloaded: null,
          officialTotal: null,
          missing: null,
          liveMirrorCount: 0,
        }),
      ),
    ).toBe('empty')
  })

  it('shows progress while a Run is in flight, even before the first file lands', () => {
    expect(
      wallBandOf(facts({ wallpaperCount: 0, downloaded: 0, liveMirrorCount: 0, running: true })),
    ).toBe('running')
    expect(wallBandOf(facts({ liveMirrorCount: 1, running: true }))).toBe('running')
    // Running beats "complete": the last files are still being written.
    expect(
      wallBandOf(
        facts({
          wallpaperCount: 1010,
          downloaded: 1010,
          missing: 0,
          liveMirrorCount: 1010,
          running: true,
        }),
      ),
    ).toBe('running')
  })

  it('conveys a resume when the gap still holds Wallpapers the Mirror does not', () => {
    // An interrupted Run: reopening must not read as starting from zero.
    expect(wallBandOf(facts())).toBe('resume')
    expect(wallBandOf(facts({ wallpaperCount: 1009, downloaded: 1009, missing: 1 }))).toBe('resume')
  })

  it('resumes on twelve missing even when three retired extras hide that from the totals', () => {
    // 1013 listed, 1001 downloaded, 12 missing, 3 retired extras the site
    // dropped: the Mirror holds 1004 Wallpapers, so the old "total > Mirror
    // count" rule would still resume — but with 12 extras it would not, and
    // twelve Wallpapers would go unmentioned. The gap is the only number that
    // decides.
    expect(
      wallBandOf(
        facts({ wallpaperCount: 1004, downloaded: 1001, officialTotal: 1013, missing: 12 }),
      ),
    ).toBe('resume')
    expect(
      wallBandOf(
        facts({ wallpaperCount: 1022, downloaded: 1010, officialTotal: 1013, missing: 3 }),
      ),
    ).toBe('resume')
  })

  it('says the last fetch was interrupted, before it says anything else about the wall', () => {
    // An unfinished, recent Run log means a start would be refused as an
    // Orphaned Run; the wall must name that instead of offering a button that
    // cannot work.
    expect(
      wallBandOf(
        facts({
          wallpaperCount: 0,
          downloaded: 0,
          liveMirrorCount: 0,
          missing: 1010,
          orphaned: true,
        }),
      ),
    ).toBe('orphaned')
    expect(wallBandOf(facts({ orphaned: true }))).toBe('orphaned')
  })

  it('adds no band once the Mirror holds everything the list names', () => {
    expect(wallBandOf(facts({ wallpaperCount: 1010, downloaded: 1010, missing: 0 }))).toBe('none')
    // Retired Mirror files are not a reason to offer a fetch — and they are not
    // a reason to withhold one either: the gap alone decides.
    expect(
      wallBandOf(
        facts({ wallpaperCount: 1013, downloaded: 1010, officialTotal: 1010, missing: 0 }),
      ),
    ).toBe('none')
  })

  it('makes no "still missing" claim when the list was not read', () => {
    // `null` is "not read", never "zero left"; a Mirror with files and no list
    // has nothing to resume *against*.
    expect(
      wallBandOf(
        facts({ wallpaperCount: 5, downloaded: null, officialTotal: null, missing: null }),
      ),
    ).toBe('none')
  })

  it('treats a list that says zero as an empty gallery, not a resume', () => {
    expect(
      wallBandOf(
        facts({
          wallpaperCount: 0,
          downloaded: 0,
          officialTotal: 0,
          missing: 0,
          liveMirrorCount: 0,
        }),
      ),
    ).toBe('empty')
    expect(
      wallBandOf(
        facts({
          wallpaperCount: 0,
          downloaded: 0,
          officialTotal: 1,
          missing: 1,
          liveMirrorCount: 0,
        }),
      ),
    ).toBe('empty')
  })
})

describe('how many Wallpapers are left', () => {
  it('is the Mirror gap’s missing count, verbatim', () => {
    expect(remainingOf(facts({ missing: 710 }))).toBe(710)
    expect(remainingOf(facts({ wallpaperCount: 1009, downloaded: 1009, missing: 1 }))).toBe(1)
  })

  it('is not the total minus the Mirror count, so retired files cannot mask a gap', () => {
    // 1013 listed, 3 missing, and 12 retired extras: `total - mirrorCount`
    // would be 0 here. The band's number stays 3.
    expect(
      remainingOf(
        facts({ wallpaperCount: 1022, downloaded: 1010, officialTotal: 1013, missing: 3 }),
      ),
    ).toBe(3)
  })

  it('is unknown when the list was not read', () => {
    // Not `0`: the page must not say "nothing left" about a list it never saw.
    expect(remainingOf(facts({ officialTotal: null, missing: null, downloaded: null }))).toBeNull()
  })
})
