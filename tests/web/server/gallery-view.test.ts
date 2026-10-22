// ── The wall's rows: only Wallpapers that really reached the disk ────
//
// A player's wall is the Mirror. A Gallery list entry with no file is not a row
// — no placeholder, no thumbnail request — and a Wallpaper the site retired but
// the Mirror still holds stays. The gap's two counts are set arithmetic over the
// official name set and the disk name set (the Run report's own), never a count
// of rows.

import { describe, expect, it } from 'vitest'

import type { GalleryList } from '../../../core/gallery/gallery-source.js'
import { parseGalleryList } from '../../../core/gallery/gallery-source.js'
import { mergeGalleryStats } from '../../../core/gallery/gallery-state.js'
import { buildGalleryView } from '../../../web/server/gallery-view.js'

const CDN = 'https://gamecms-res.sl916.com/official_website_resource/50001/4/PICTURE'
const RETIRED = '978.竖版-2560x1440_61032b056992416faaf041b01d7c1633.jpg'

/** A fixture list, built as data: one entry per (id, name) pair. */
function listOf(...specs: [number, string][]): GalleryList {
  return {
    total: specs.length,
    entries: specs.map(([id, name]) => ({ id, url: `${CDN}/20261007/${name}` })),
  }
}

function viewOf(list: GalleryList | null, diskFiles: readonly string[]) {
  return buildGalleryView({ list, diskFiles, newSinceLastRun: null })
}

describe('buildGalleryView', () => {
  it('keeps a downloaded Gallery entry on the wall, in the list’s order', () => {
    const view = viewOf(listOf([1012, '1012_hash.jpg'], [1011, '1011_hash.jpg']), [
      '1011_hash.jpg',
      '1012_hash.jpg',
      '.gallery-state.json',
    ])

    expect(view.rows).toEqual([
      { id: 1012, name: '1012_hash.jpg' },
      { id: 1011, name: '1011_hash.jpg' },
    ])
    expect(view.officialTotal).toBe(2)
    expect(view.listAvailable).toBe(true)
  })

  it('does not put an entry with no file on the wall: no row at all', () => {
    // 1011 is on the official list and nowhere on the disk. It has no
    // placeholder, no name to label and nothing to request a thumbnail for.
    const view = viewOf(listOf([1012, '1012_hash.jpg'], [1011, '1011_hash.jpg']), ['1012_hash.jpg'])

    expect(view.rows).toEqual([{ id: 1012, name: '1012_hash.jpg' }])
    expect(view.rows.some(row => row.name === '1011_hash.jpg')).toBe(false)
  })

  it('keeps a retired Wallpaper the Mirror still holds, sorted after the list’s rows', () => {
    const another = '977.竖版-2560x1440_71032b056992416faaf041b01d7c1633.jpg'
    const view = viewOf(listOf([1012, '1012_hash.jpg']), [
      '1012_hash.jpg',
      RETIRED,
      another,
      // On disk, not a Wallpaper: not a row, but it is still a disk name the
      // gap counts (the Run report counts it too).
      'notes.txt',
      '.gallery-state.json',
    ])

    expect(view.rows).toEqual([
      { id: 1012, name: '1012_hash.jpg' },
      { id: null, name: another },
      { id: null, name: RETIRED },
    ])
    // The gap is the Run report's: three Mirror names are not in the list, one
    // of them a stray text file.
    expect(view.mirrorGap).toEqual({ missing: 0, extra: 3 })
  })

  it('needs both a file and a Wallpaper name for a row', () => {
    // A Gallery entry whose URL names something the Wallpaper URL set does not
    // accept is on the list and on the disk, and still is not a wall tile: the
    // thumbnail route could only answer it with a 400.
    const view = viewOf(listOf([1012, '1012_hash.jpg'], [1011, 'site-icon.svg']), [
      '1012_hash.jpg',
      'site-icon.svg',
    ])

    expect(view.rows).toEqual([{ id: 1012, name: '1012_hash.jpg' }])
    // Set arithmetic is unchanged by "can it be a row": the name is on both
    // sides, so it is neither missing nor extra — exactly as the Run report
    // counts the same directory.
    expect(view.mirrorGap).toEqual({ missing: 0, extra: 0 })
  })

  it('reports both directions of the gap as set arithmetic over the names', () => {
    const view = viewOf(listOf([1012, '1012_hash.jpg'], [1011, '1011_hash.jpg']), ['1012_hash.jpg'])

    expect(view.mirrorGap).toEqual({ missing: 1, extra: 0 })
  })

  it('takes its counts from the official name set, not from the rows, when names repeat', () => {
    // Two entries share a name and neither file is on disk. The official names
    // are a Set and the rows are per entry, so a row-derived count would be 2
    // while the Run report counts 1. The view publishes the Run report's number
    // — and no row, because neither entry has a file.
    const list = listOf([1012, 'same_hash.jpg'], [1011, 'same_hash.jpg'])
    const view = viewOf(list, [])

    expect(view.rows).toEqual([])
    expect(view.mirrorGap).toEqual({ missing: 1, extra: 0 })

    const { stats } = mergeGalleryStats(
      null,
      { list, diskFiles: [] },
      'run-1',
      '2026-10-18T00:00:00.000Z',
    )
    expect(view.mirrorGap).toEqual({
      missing: stats.mirror?.missingFromDisk.count,
      extra: stats.mirror?.extraOnDisk.count,
    })
  })

  it("agrees with the Run report's Mirror gap for the same list and disk names", () => {
    const list = listOf([1012, '1012_hash.jpg'], [1011, '1011_hash.jpg'])
    const diskFiles = ['1012_hash.jpg', RETIRED, 'notes.txt', '.gallery-state.json']

    const view = viewOf(list, diskFiles)
    const { stats } = mergeGalleryStats(
      null,
      { list, diskFiles },
      'run-1',
      '2026-10-18T00:00:00.000Z',
    )

    expect(view.mirrorGap).toEqual({
      missing: stats.mirror?.missingFromDisk.count,
      extra: stats.mirror?.extraOnDisk.count,
    })
    expect(view.mirrorGap).toEqual({ missing: 1, extra: 2 })
  })

  it("labels an entry by the gallery's id even when the payload's title is null or disagrees", () => {
    // The list schema strips `title`; these fixtures carry it anyway (a null,
    // and one whose leading number is not the id) to prove the row is labelled
    // by `id` and named from the URL — never from `title` (spec decision 17).
    const list = parseGalleryList({
      code: 200,
      data: {
        total: 2,
        pageData: [
          {
            id: 317,
            title: null,
            pictureUrl: `${CDN}/20261007/312 2436x1125_5e70d8a50d9a477a8c0918174bd56db4.jpg`,
          },
          {
            id: 620,
            title: '999. not this entry',
            pictureUrl: `${CDN}/20261007/620 1440×2560 _66312babc4e64ec38d5d498b8aebd265.jpg`,
          },
        ],
      },
    })

    const view = viewOf(list, [
      '312 2436x1125_5e70d8a50d9a477a8c0918174bd56db4.jpg',
      '620 1440×2560 _66312babc4e64ec38d5d498b8aebd265.jpg',
    ])

    expect(view.rows).toEqual([
      {
        id: 317,
        name: '312 2436x1125_5e70d8a50d9a477a8c0918174bd56db4.jpg',
      },
      {
        id: 620,
        name: '620 1440×2560 _66312babc4e64ec38d5d498b8aebd265.jpg',
      },
    ])
  })

  it('echoes the newest Run report new-since-the-last-Run', () => {
    const withNew = buildGalleryView({
      list: listOf([1012, '1012_hash.jpg']),
      diskFiles: ['1012_hash.jpg'],
      newSinceLastRun: 12,
    })
    const without = buildGalleryView({
      list: listOf([1012, '1012_hash.jpg']),
      diskFiles: ['1012_hash.jpg'],
      newSinceLastRun: null,
    })

    expect(withNew.newSinceLastRun).toBe(12)
    expect(without.newSinceLastRun).toBeNull()
  })

  it('degrades to the Mirror’s Wallpapers when the list was not read', () => {
    const view = buildGalleryView({
      list: null,
      diskFiles: ['b_hash.jpg', 'a_hash.jpg', RETIRED, 'notes.txt', '.gallery-state.json'],
      newSinceLastRun: 12,
    })

    expect(view.listAvailable).toBe(false)
    expect(view.officialTotal).toBeNull()
    // "Not checked" is never "nothing missing" (ADR 0006).
    expect(view.mirrorGap).toBeNull()
    // Without the list there is no official name set, so every Wallpaper on
    // disk is a row, sorted — and a name that is not a Wallpaper still is not.
    expect(view.rows).toEqual([
      { id: null, name: RETIRED },
      { id: null, name: 'a_hash.jpg' },
      { id: null, name: 'b_hash.jpg' },
    ])
    // A fact about a Run, not about the list: still reported.
    expect(view.newSinceLastRun).toBe(12)
  })
})
