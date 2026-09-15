import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { GalleryStats } from '../../src/report/gallery.js'
import {
  countWallpapers,
  isWallpaperFile,
  mergeGalleryStats,
  readGalleryStats,
  writeGalleryStats,
} from '../../src/report/gallery.js'

describe('isWallpaperFile', () => {
  it('accepts the extensions the CDN serves, case-insensitively', () => {
    expect(isWallpaperFile('1012.竖版-2560x1440_5e7b.jpg')).toBe(true)
    expect(isWallpaperFile('161 1125x2436_7ab568b5.jpeg')).toBe(true)
    expect(isWallpaperFile('x.WEBP')).toBe(true)
  })

  it('rejects non-image files and extension-less names', () => {
    expect(isWallpaperFile('detail.html')).toBe(false)
    expect(isWallpaperFile('README')).toBe(false)
    expect(isWallpaperFile('.jpg')).toBe(false)
  })
})

describe('countWallpapers', () => {
  it('counts only Wallpaper files', () => {
    expect(countWallpapers(['a.jpg', 'b.jpeg', 'detail.html', 'hm.gif', 'notes.txt'])).toBe(3)
    expect(countWallpapers([])).toBe(0)
  })
})

describe('mergeGalleryStats', () => {
  const previous: GalleryStats = {
    officialTotal: 1001,
    previousOfficialTotal: 965,
    newSinceLastRun: 36,
    firstRun: false,
    updatedAt: '2026-09-14T14:11:51.730Z',
    runId: '2026-09-14T14-07-49',
  }

  it('records a first Run by back-deriving the previous total from this Run', () => {
    const stats = mergeGalleryStats(null, 1001, 36, 'run-1', '2026-09-15T00:00:00.000Z')
    expect(stats).toEqual({
      officialTotal: 1001,
      previousOfficialTotal: 965,
      newSinceLastRun: 36,
      firstRun: true,
      updatedAt: '2026-09-15T00:00:00.000Z',
      runId: 'run-1',
    })
  })

  it('counts a first Run with no new downloads as zero growth', () => {
    const stats = mergeGalleryStats(null, 1001, 0, 'run-1', '2026-09-15T00:00:00.000Z')
    expect(stats.previousOfficialTotal).toBe(1001)
    expect(stats.newSinceLastRun).toBe(0)
    expect(stats.firstRun).toBe(true)
  })

  it('reports growth against the previous Run', () => {
    const stats = mergeGalleryStats(previous, 1037, 36, 'run-2', '2026-09-15T00:00:00.000Z')
    expect(stats.officialTotal).toBe(1037)
    expect(stats.previousOfficialTotal).toBe(1001)
    expect(stats.newSinceLastRun).toBe(36)
    expect(stats.firstRun).toBe(false)
  })

  it('never lets the total fall when files disappear from disk', () => {
    const stats = mergeGalleryStats(previous, 900, 0, 'run-2', '2026-09-15T00:00:00.000Z')
    expect(stats.officialTotal).toBe(1001)
    expect(stats.newSinceLastRun).toBe(0)
  })

  it('reports an all-skipped Run as zero growth', () => {
    const stats = mergeGalleryStats(previous, 1001, 0, 'run-2', '2026-09-15T00:00:00.000Z')
    expect(stats.officialTotal).toBe(1001)
    expect(stats.newSinceLastRun).toBe(0)
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

  const stats: GalleryStats = {
    officialTotal: 1001,
    previousOfficialTotal: 965,
    newSinceLastRun: 36,
    firstRun: false,
    updatedAt: '2026-09-14T14:11:51.730Z',
    runId: '2026-09-14T14-07-49',
  }

  it('round-trips through disk', () => {
    const file = stateFile()
    writeGalleryStats(file, stats)
    expect(readGalleryStats(file)).toEqual(stats)
  })

  it('treats a missing file as "no record yet"', () => {
    expect(readGalleryStats(stateFile())).toBeNull()
  })

  it('tolerates a corrupt or foreign file instead of throwing', () => {
    const file = stateFile()
    fs.writeFileSync(file, 'not json at all', 'utf8')
    expect(readGalleryStats(file)).toBeNull()

    fs.writeFileSync(file, JSON.stringify({ hello: 'world' }), 'utf8')
    expect(readGalleryStats(file)).toBeNull()

    fs.writeFileSync(file, JSON.stringify({ officialTotal: 'many' }), 'utf8')
    expect(readGalleryStats(file)).toBeNull()
  })
})
