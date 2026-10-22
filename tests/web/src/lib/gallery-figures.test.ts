// ── The one figures line (#94) ──────────────────────────────────────
//
// `Gallery N · downloaded N · missing N` (plus `· extra N` when any exist), or
// "Gallery unread" — the same sentence above the wall and in the Run panel, so
// the two cannot disagree about 1001 versus 1013.
//
// `downloaded` is the official entries whose file is on disk, i.e. the
// complement of the gap over the Gallery total. It is deliberately NOT the
// Mirror's count: retired local files are not downloads, and counting them
// would make the line stop adding up.

import { describe, expect, it } from 'vitest'

import { galleryFiguresOf } from '../../../../web/src/lib/gallery-figures.js'

/** The payload fields the figures read, in the shape `GET /api/gallery` sends. */
function payload(
  officialTotal: number | null,
  mirrorGap: { missing: number; extra: number } | null,
) {
  return { officialTotal, mirrorGap }
}

describe('galleryFiguresOf', () => {
  it('is unread before the page has read anything', () => {
    expect(galleryFiguresOf(null)).toBeNull()
  })

  it('says the list is unread when the Gallery list was not read', () => {
    // `mirrorGap: null` is "not checked", never `{0, 0}` (ADR 0006).
    expect(galleryFiguresOf(payload(null, null))).toEqual({
      officialTotal: null,
      downloaded: null,
      missing: null,
      extra: null,
    })
  })

  it('never invents a missing count from a payload that has no gap', () => {
    expect(galleryFiguresOf(payload(1013, null))).toEqual({
      officialTotal: null,
      downloaded: null,
      missing: null,
      extra: null,
    })
  })

  it('counts downloaded as the gap’s complement, so the three numbers add up', () => {
    const figures = galleryFiguresOf(payload(1013, { missing: 12, extra: 3 }))

    expect(figures).toEqual({
      officialTotal: 1013,
      downloaded: 1001,
      missing: 12,
      extra: 3,
    })
    // The whole point of the line: no subtraction for the reader.
    expect((figures?.downloaded ?? 0) + (figures?.missing ?? 0)).toBe(figures?.officialTotal)
  })

  it('keeps retired extras out of the downloaded count', () => {
    // A complete Mirror of 1013 plus 12 retired files: `downloaded` stays 1013,
    // and the extra files are named as extras, not counted as progress.
    expect(galleryFiguresOf(payload(1013, { missing: 0, extra: 12 }))).toEqual({
      officialTotal: 1013,
      downloaded: 1013,
      missing: 0,
      extra: 12,
    })
  })

  it('reports zero extras so the caller can leave the extra clause out', () => {
    expect(galleryFiguresOf(payload(1013, { missing: 12, extra: 0 }))).toEqual({
      officialTotal: 1013,
      downloaded: 1001,
      missing: 12,
      extra: 0,
    })
  })
})
