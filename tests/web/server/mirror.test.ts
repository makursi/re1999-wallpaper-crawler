import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { countMirrorNames, countMirrorWallpapers } from '../../../web/server/mirror.js'

const roots: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-mirror-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('countMirrorNames', () => {
  it('counts every non-dot name, images and non-images alike', () => {
    // This is the set the Run report computes `extraOnDisk` from, so a
    // `notes.txt` or a junk name is part of it. Counting only image extensions
    // would return 2 here and make the page disagree with the report the first
    // time a non-image landed in `images/`.
    expect(
      countMirrorNames(['1013_8dee54e8.jpg', 'notes.txt', 'thumbs', '.gallery-state.json']),
    ).toBe(3)
  })

  it('skips a dot-prefixed name even when it looks like a Wallpaper', () => {
    expect(countMirrorNames(['.hidden.jpg', '1013_8dee54e8.jpg'])).toBe(1)
  })

  it('reads an empty Mirror as zero', () => {
    expect(countMirrorNames([])).toBe(0)
  })
})

describe('countMirrorWallpapers', () => {
  it('skips the Gallery state file beside the Wallpapers', () => {
    const imagesDir = tempDir()
    fs.writeFileSync(path.join(imagesDir, '1013_8dee54e8.jpg'), 'a')
    fs.writeFileSync(path.join(imagesDir, '1014_11a9938e.png'), 'b')
    fs.writeFileSync(path.join(imagesDir, '.gallery-state.json'), '{}')

    expect(countMirrorWallpapers(imagesDir)).toBe(2)
  })

  it('reads a Mirror that is not there yet as zero', () => {
    const imagesDir = tempDir()
    fs.rmSync(imagesDir, { recursive: true, force: true })

    expect(countMirrorWallpapers(imagesDir)).toBe(0)
  })
})
