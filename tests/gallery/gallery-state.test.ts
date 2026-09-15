import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { GalleryList } from '../../src/gallery/gallery-source.js'
import {
  mergeGalleryStats,
  readGalleryState,
  unavailableGalleryStats,
  writeGalleryState,
} from '../../src/gallery/gallery-state.js'

const CDN = 'https://gamecms-res.sl916.com/official_website_resource/50001/4/PICTURE'

function listOf(...specs: [id: number, name: string][]): GalleryList {
  return {
    total: specs.length,
    entries: specs.map(([id, name]) => ({
      id,
      url: `${CDN}/20260907/${name}`,
    })),
  }
}

describe('mergeGalleryStats', () => {
  it('adopts every entry on the first record without claiming they are new', () => {
    const list = listOf([1012, '1012.jpg'], [1011, '1011.jpg'])
    const { state, stats } = mergeGalleryStats(
      null,
      { list, diskFiles: ['1012.jpg', '1011.jpg'] },
      'run-1',
      '2026-09-16T00:00:00.000Z',
    )

    expect(state).toEqual({
      version: 1,
      ids: [1011, 1012],
      updatedAt: '2026-09-16T00:00:00.000Z',
      runId: 'run-1',
    })
    expect(stats).toEqual({
      officialTotal: 2,
      newSinceLastRun: null,
      newFiles: [],
      firstRun: true,
      mirror: { missingFromDisk: { count: 0, files: [] }, extraOnDisk: { count: 0, files: [] } },
    })
  })

  it('counts the entries the previous Run had not seen', () => {
    const previous = {
      version: 1 as const,
      ids: [1010, 1011],
      updatedAt: '2026-09-15T00:00:00.000Z',
      runId: 'run-1',
    }
    const list = listOf([1012, '1012.jpg'], [1011, '1011.jpg'], [1010, '1010.jpg'])
    const { state, stats } = mergeGalleryStats(
      previous,
      { list, diskFiles: ['1010.jpg', '1011.jpg', '1012.jpg'] },
      'run-2',
      '2026-09-16T00:00:00.000Z',
    )

    expect(stats.newSinceLastRun).toBe(1)
    expect(stats.newFiles).toEqual(['1012.jpg'])
    expect(stats.officialTotal).toBe(3)
    expect(stats.firstRun).toBe(false)
    expect(state.ids).toEqual([1010, 1011, 1012])
    expect(state.runId).toBe('run-2')
  })

  it('keeps ids the list no longer carries, so a returning entry is not new twice', () => {
    const previous = {
      version: 1 as const,
      ids: [1010, 1011, 1012],
      updatedAt: '2026-09-15T00:00:00.000Z',
      runId: 'run-1',
    }
    // The site retired 1010 and 1011: the list no longer carries them, but one
    // of them is still on disk. Forgetting the id would report a returning
    // entry as new again.
    const list = listOf([1012, '1012.jpg'])
    const { state, stats } = mergeGalleryStats(
      previous,
      { list, diskFiles: ['1010.jpg', '1012.jpg'] },
      'run-2',
      '2026-09-16T00:00:00.000Z',
    )

    expect(state.ids).toEqual([1010, 1011, 1012])
    expect(stats.officialTotal).toBe(1)
    expect(stats.newSinceLastRun).toBe(0)
    expect(stats.newFiles).toEqual([])
    expect(stats.mirror?.missingFromDisk).toEqual({ count: 0, files: [] })
    expect(stats.mirror?.extraOnDisk).toEqual({ count: 1, files: ['1010.jpg'] })
  })

  it('reports both directions of a mirror gap, ignoring the state file itself', () => {
    const list = listOf([1012, '1012.jpg'], [1011, '1011.jpg'])
    const { stats } = mergeGalleryStats(
      null,
      { list, diskFiles: ['.gallery-state.json', '1012.jpg', 'detail.html', 'hm.gif'] },
      'run-1',
      '2026-09-16T00:00:00.000Z',
    )

    expect(stats.mirror?.missingFromDisk).toEqual({ count: 1, files: ['1011.jpg'] })
    expect(stats.mirror?.extraOnDisk).toEqual({ count: 2, files: ['detail.html', 'hm.gif'] })
  })

  it('matches the list against disk names even when the URL is percent-encoded', () => {
    const list: GalleryList = {
      total: 1,
      entries: [
        {
          id: 996,
          url: `${CDN}/20260729/996.%E7%AB%96%E7%89%88-2560x1440_abc.jpg`,
        },
      ],
    }
    const { stats } = mergeGalleryStats(
      null,
      { list, diskFiles: ['996.竖版-2560x1440_abc.jpg'] },
      'run-1',
      '2026-09-16T00:00:00.000Z',
    )

    expect(stats.mirror).toEqual({
      missingFromDisk: { count: 0, files: [] },
      extraOnDisk: { count: 0, files: [] },
    })
  })
})

describe('gallery state file', () => {
  const dirs: string[] = []

  function stateFile(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-'))
    dirs.push(dir)
    return path.join(dir, 'gallery-state.json')
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  const state = {
    version: 1 as const,
    ids: [1011, 1012],
    updatedAt: '2026-09-15T00:00:00.000Z',
    runId: 'run-1',
  }

  it('round-trips through disk', () => {
    const file = stateFile()
    writeGalleryState(file, state)
    expect(readGalleryState(file)).toEqual(state)
  })

  it('treats a missing file as "no record yet"', () => {
    expect(readGalleryState(stateFile())).toBeNull()
  })

  it('tolerates a corrupt, foreign or superseded file instead of throwing', () => {
    const file = stateFile()
    for (const contents of [
      'not json at all',
      JSON.stringify({ hello: 'world' }),
      JSON.stringify({ officialTotal: 1001, previousOfficialTotal: 1001 }),
      JSON.stringify({ version: 1, ids: ['1012'] }),
      JSON.stringify({ version: 2, ids: [1012] }),
    ]) {
      fs.writeFileSync(file, contents, 'utf8')
      expect(readGalleryState(file)).toBeNull()
    }
  })
})

describe('unavailableGalleryStats', () => {
  it('reports unknown numbers rather than a fabricated total', () => {
    expect(unavailableGalleryStats(null)).toEqual({
      officialTotal: null,
      newSinceLastRun: null,
      newFiles: [],
      firstRun: true,
      mirror: null,
    })
  })
})
