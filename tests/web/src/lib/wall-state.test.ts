// ── The wall's own three questions (#83) ────────────────────────────
//
// The first-run wall has to explain itself: what the reader can do now (start),
// what is happening (progress), and what is left (resume after an interruption).
// Which of those the wall carries is a rule, not a template detail, so it is a
// pure function here and the page only renders the answer. The numbers come
// straight from the status contract — the Mirror's count and the Gallery list's
// total — and nothing in this file invents a third count.

import { describe, expect, it } from 'vitest'

import { remainingOf, wallBandOf } from '../../../../web/src/lib/wall-state.js'

describe('the wall’s band', () => {
  it('offers the start entry point on an empty wall', () => {
    // A fresh install: nothing in the Mirror, the list read, nothing running.
    expect(
      wallBandOf({ mirrorCount: 0, officialTotal: 1010, running: false, orphaned: false }),
    ).toBe('empty')
  })

  it('offers the start entry point even before the list was read', () => {
    // The reader still needs the one action that matters while the first read
    // is failing; the failure band above explains the rest.
    expect(
      wallBandOf({ mirrorCount: 0, officialTotal: null, running: false, orphaned: false }),
    ).toBe('empty')
  })

  it('shows progress while a Run is in flight, even before the first file lands', () => {
    expect(
      wallBandOf({ mirrorCount: 0, officialTotal: 1010, running: true, orphaned: false }),
    ).toBe('running')
    expect(
      wallBandOf({ mirrorCount: 1, officialTotal: 1010, running: true, orphaned: false }),
    ).toBe('running')
    // Running beats "complete": the last files are still being written.
    expect(
      wallBandOf({ mirrorCount: 1010, officialTotal: 1010, running: true, orphaned: false }),
    ).toBe('running')
  })

  it('conveys a resume when the list still holds Wallpapers the Mirror does not', () => {
    // An interrupted Run: reopening must not read as starting from zero.
    expect(
      wallBandOf({ mirrorCount: 300, officialTotal: 1010, running: false, orphaned: false }),
    ).toBe('resume')
    expect(
      wallBandOf({ mirrorCount: 1009, officialTotal: 1010, running: false, orphaned: false }),
    ).toBe('resume')
  })

  it('says the last fetch was interrupted, before it says anything else about the wall', () => {
    // An unfinished, recent Run log means a start would be refused as an
    // Orphaned Run; the wall must name that instead of offering a button that
    // cannot work.
    expect(
      wallBandOf({ mirrorCount: 0, officialTotal: 1010, running: false, orphaned: true }),
    ).toBe('orphaned')
    expect(
      wallBandOf({ mirrorCount: 300, officialTotal: 1010, running: false, orphaned: true }),
    ).toBe('orphaned')
  })

  it('adds no band once the Mirror holds everything the list names', () => {
    expect(
      wallBandOf({ mirrorCount: 1010, officialTotal: 1010, running: false, orphaned: false }),
    ).toBe('none')
    // Mirror extras are files the gallery has since dropped: they are not a
    // reason to offer a fetch, and the wall's caption already names them.
    expect(
      wallBandOf({ mirrorCount: 1013, officialTotal: 1010, running: false, orphaned: false }),
    ).toBe('none')
  })

  it('makes no "still missing" claim when the list was not read', () => {
    // `null` is "not read", never "zero left"; a Mirror with files and no list
    // has nothing to resume *against*.
    expect(
      wallBandOf({ mirrorCount: 5, officialTotal: null, running: false, orphaned: false }),
    ).toBe('none')
  })

  it('treats a list that says zero as an empty gallery, not a resume', () => {
    expect(wallBandOf({ mirrorCount: 0, officialTotal: 0, running: false, orphaned: false })).toBe(
      'empty',
    )
    expect(wallBandOf({ mirrorCount: 0, officialTotal: 1, running: false, orphaned: false })).toBe(
      'empty',
    )
  })
})

describe('how many Wallpapers the list still owes the Mirror', () => {
  it('is the difference between the list’s total and the Mirror’s count', () => {
    expect(
      remainingOf({ mirrorCount: 300, officialTotal: 1010, running: false, orphaned: false }),
    ).toBe(710)
    expect(
      remainingOf({ mirrorCount: 1009, officialTotal: 1010, running: false, orphaned: false }),
    ).toBe(1)
  })

  it('never goes negative, because Mirror extras are not negative downloads', () => {
    expect(
      remainingOf({ mirrorCount: 1013, officialTotal: 1010, running: false, orphaned: false }),
    ).toBe(0)
    expect(
      remainingOf({ mirrorCount: 1010, officialTotal: 1010, running: false, orphaned: false }),
    ).toBe(0)
  })

  it('is unknown when the list was not read', () => {
    // Not `0`: the page must not say "nothing left" about a list it never saw.
    expect(
      remainingOf({ mirrorCount: 300, officialTotal: null, running: false, orphaned: false }),
    ).toBeNull()
  })
})
