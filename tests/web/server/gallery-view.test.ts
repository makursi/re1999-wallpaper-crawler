import { describe, expect, it } from 'vitest'

import type { GalleryList } from '../../../core/gallery/gallery-source.js'
import { parseGalleryList } from '../../../core/gallery/gallery-source.js'
import { mergeGalleryStats } from '../../../core/gallery/gallery-state.js'
import { buildGalleryView } from '../../../web/server/gallery-view.js'

const CDN = 'https://gamecms-res.sl916.com/official_website_resource/50001/4/PICTURE'

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
  it('makes one row per Gallery list entry, on disk when the name is there', () => {
    const view = viewOf(listOf([1012, '1012_hash.jpg'], [1011, '1011_hash.jpg']), [
      '1012_hash.jpg',
      '.gallery-state.json',
    ])

    expect(view.rows).toEqual([
      { id: 1012, name: '1012_hash.jpg', state: 'on-disk', viewable: true },
      { id: 1011, name: '1011_hash.jpg', state: 'missing', viewable: false },
    ])
    expect(view.officialTotal).toBe(2)
    expect(view.listAvailable).toBe(true)
  })

  it('marks a Mirror file the list does not contain as not in the gallery', () => {
    // The three retired files are exactly this row: on disk, no longer in the
    // list. `notes.txt` rides along to pin the predicate (non-dot, not
    // `isWallpaperFile`).
    const retired = '978.竖版-2560x1440_61032b056992416faaf041b01d7c1633.jpg'
    const view = viewOf(listOf([1012, '1012_hash.jpg'], [1011, '1011_hash.jpg']), [
      '1012_hash.jpg',
      '1011_hash.jpg',
      'notes.txt',
      '.gallery-state.json',
      retired,
    ])

    expect(view.rows).toEqual([
      { id: 1012, name: '1012_hash.jpg', state: 'on-disk', viewable: true },
      { id: 1011, name: '1011_hash.jpg', state: 'on-disk', viewable: true },
      { id: null, name: retired, state: 'not-in-gallery', viewable: true },
      { id: null, name: 'notes.txt', state: 'not-in-gallery', viewable: false },
    ])
    expect(view.mirrorGap).toEqual({ missing: 0, extra: 2 })
  })

  it('says whether a row can be shown: on disk and a Wallpaper, both required', () => {
    // Three answers in one view — an entry the Mirror holds, an entry it does
    // not, and a Mirror extra that is not an image at all. The page asks for a
    // thumbnail only for the first, so `notes.txt` costs no request at all.
    const view = viewOf(listOf([1012, '1012_hash.jpg'], [1011, '1011_hash.jpg']), [
      '1012_hash.jpg',
      'notes.txt',
    ])

    expect(view.rows.map(row => [row.name, row.viewable])).toEqual([
      ['1012_hash.jpg', true],
      ['1011_hash.jpg', false],
      ['notes.txt', false],
    ])
  })

  it('reports both directions of the gap: names the list has and the Mirror does not', () => {
    const view = viewOf(listOf([1012, '1012_hash.jpg'], [1011, '1011_hash.jpg']), ['1012_hash.jpg'])

    expect(view.mirrorGap).toEqual({ missing: 1, extra: 0 })
  })

  it('takes its counts from the official name set, not from the rows, when names repeat', () => {
    // Two entries share a name and neither file is on disk. The official names
    // are a Set and the rows are per entry, so the row-derived count would be 2
    // while the Run report counts 1. The view publishes the Run report's number.
    const list = listOf([1012, 'same_hash.jpg'], [1011, 'same_hash.jpg'])
    const view = viewOf(list, [])

    expect(view.rows.filter(row => row.state === 'missing')).toHaveLength(2)
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
    const retired = '978.竖版-2560x1440_61032b056992416faaf041b01d7c1633.jpg'
    const list = listOf([1012, '1012_hash.jpg'], [1011, '1011_hash.jpg'])
    const diskFiles = ['1012_hash.jpg', retired, 'notes.txt', '.gallery-state.json']

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

    const view = viewOf(list, ['312 2436x1125_5e70d8a50d9a477a8c0918174bd56db4.jpg'])

    expect(view.rows).toEqual([
      {
        id: 317,
        name: '312 2436x1125_5e70d8a50d9a477a8c0918174bd56db4.jpg',
        state: 'on-disk',
        viewable: true,
      },
      {
        id: 620,
        name: '620 1440×2560 _66312babc4e64ec38d5d498b8aebd265.jpg',
        state: 'missing',
        viewable: false,
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

  it('degrades to the Mirror alone when the list was not read', () => {
    const retired = '978.竖版-2560x1440_61032b056992416faaf041b01d7c1633.jpg'
    const view = buildGalleryView({
      list: null,
      diskFiles: ['a_hash.jpg', retired, 'notes.txt', '.gallery-state.json'],
      newSinceLastRun: 12,
    })

    expect(view.listAvailable).toBe(false)
    expect(view.officialTotal).toBeNull()
    // "Not checked" is never "nothing missing" (ADR 0006).
    expect(view.mirrorGap).toBeNull()
    // Without the list there is no official name set, so "not in the gallery"
    // is unknowable: every Mirror file is simply on disk.
    expect(view.rows.map(row => row.name).toSorted()).toEqual(
      ['a_hash.jpg', 'notes.txt', retired].toSorted(),
    )
    expect(view.rows.every(row => row.id === null && row.state === 'on-disk')).toBe(true)
    expect(view.rows.some(row => row.state === 'not-in-gallery')).toBe(false)
    // With no list, "can it be shown" still has one answer the service owns:
    // whether the name is a Wallpaper at all. `notes.txt` is not.
    expect(view.rows.find(row => row.name === 'notes.txt')?.viewable).toBe(false)
    expect(view.rows.find(row => row.name === 'a_hash.jpg')?.viewable).toBe(true)
    // A fact about a Run, not about the list: still reported.
    expect(view.newSinceLastRun).toBe(12)
  })
})
