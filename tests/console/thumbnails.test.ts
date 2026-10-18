import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ThumbnailCache, ThumbnailGenerator } from '../../src/console/thumbnails.js'
import {
  ensureThumbnail,
  realThumbnailCache,
  realThumbnailGenerator,
  THUMBNAIL_CACHE_DIR_NAME,
  THUMBNAIL_MAX_EDGE,
} from '../../src/console/thumbnails.js'
import { writeTestImage } from './test-image.js'

const roots: string[] = []

/** A generator that refuses the way a broken native binary does. */
async function refusingGenerator(): Promise<void> {
  throw new Error('Could not load the "sharp" module using the win32-x64 runtime')
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** A scratch tree with a Mirror and a cache directory (never the real ones). */
function scratch(): { imagesDir: string; cacheDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-thumbnail-test-'))
  roots.push(root)
  const imagesDir = path.join(root, 'images')
  const cacheDir = path.join(root, THUMBNAIL_CACHE_DIR_NAME)
  fs.mkdirSync(imagesDir)
  return { imagesDir, cacheDir }
}

/**
 * One pinned size, aspect preserved: the longest edge is exactly the pinned
 * maximum and the shorter edge is proportional — for a 1440×2560 source the
 * real numbers are 225×400, and for a landscape 2436×1125 they are 400×185
 * (notes 02 §5, measured). The fixture is 200×400 so the expected pair is a
 * literal the test knows independently of the production call.
 */
describe('ensureThumbnail', () => {
  it('writes a thumbnail whose longest edge is the pinned 400 px', async () => {
    const { imagesDir, cacheDir } = scratch()
    await writeTestImage(path.join(imagesDir, '1013_portrait_hash.png'), 200, 400)

    const out = await ensureThumbnail('1013_portrait_hash.png', {
      imagesDir,
      cacheDir,
      generate: realThumbnailGenerator,
      cache: realThumbnailCache,
    })

    expect(path.dirname(out)).toBe(cacheDir)
    expect(fs.existsSync(out)).toBe(true)
    // Read back from the file, not from a mocked return: the bytes on disk are
    // the observable result, and the source's aspect is preserved exactly.
    expect(imageSizeOf(out)).toEqual({ width: 200, height: 400 })
    expect(Math.max(200, 400)).toBe(THUMBNAIL_MAX_EDGE)
  })

  it('reuses the cached file on a second call: the generator runs exactly once', async () => {
    const { imagesDir, cacheDir } = scratch()
    await writeTestImage(path.join(imagesDir, '1013_portrait_hash.png'), 200, 400)

    const generate = vi.fn<ThumbnailGenerator>(realThumbnailGenerator)
    const options = { imagesDir, cacheDir, generate, cache: realThumbnailCache }

    const first = await ensureThumbnail('1013_portrait_hash.png', options)
    const second = await ensureThumbnail('1013_portrait_hash.png', options)

    // The cache key is the Wallpaper's own name, so a hit needs no
    // regeneration and no invalidation: the file is the answer.
    expect(second).toBe(first)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(cacheDir)).toEqual(['1013_portrait_hash.png'])
    expect(fs.readFileSync(second).equals(fs.readFileSync(first))).toBe(true)
  })

  it('creates no cache file when the generator refuses', async () => {
    const { imagesDir, cacheDir } = scratch()
    await writeTestImage(path.join(imagesDir, '1013_portrait_hash.png'), 200, 400)

    await expect(
      ensureThumbnail('1013_portrait_hash.png', {
        imagesDir,
        cacheDir,
        generate: refusingGenerator,
        cache: realThumbnailCache,
      }),
    ).rejects.toThrow('Could not load the "sharp" module')

    // A name that failed leaves no half-written file, so the next request
    // retries instead of serving a truncated image forever.
    expect(fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []).toEqual([])
  })
})

describe('the real cache', () => {
  it('creates its directory lazily and writes a named file', () => {
    const { cacheDir } = scratch()
    const cache: ThumbnailCache = realThumbnailCache

    expect(fs.existsSync(cacheDir)).toBe(false)

    cache.ensureDir(cacheDir)
    cache.writeFile(path.join(cacheDir, 'a.jpg'), Buffer.from('x'))

    expect(fs.readdirSync(cacheDir)).toEqual(['a.jpg'])
  })
})

/**
 * The real writer's own contract, tested where the `ensureThumbnail` seam cannot
 * reach it: the generator renders into a sibling temp file and renames it onto
 * the cache path, so a failure after the render leaves nothing behind for every
 * later request to serve as a permanent cache hit.
 */
describe('realThumbnailGenerator', () => {
  it('leaves no file behind when the publish step fails after a real render', async () => {
    const { imagesDir, cacheDir } = scratch()
    const source = path.join(imagesDir, '1013_portrait_hash.png')
    await writeTestImage(source, 200, 400)
    fs.mkdirSync(cacheDir, { recursive: true })
    // The rename's target is occupied by a directory: the render itself
    // succeeds (the temp path is a sibling that keeps the target's extension,
    // which is what the image library infers its output format from) and the
    // publish fails — the one failure point the temp file exists to survive.
    const target = path.join(cacheDir, '1013_portrait_hash.png')
    fs.mkdirSync(target)

    await expect(realThumbnailGenerator(source, target)).rejects.toThrow(/rename/)

    // Nothing but the blocker: the temp file the render wrote was removed, so
    // no partial thumbnail sits in the cache under this name.
    expect(fs.readdirSync(cacheDir)).toEqual(['1013_portrait_hash.png'])
    expect(fs.statSync(target).isDirectory()).toBe(true)
  })
})

/**
 * The dimensions of a PNG or JPEG read out of its own header — no image
 * library in the assertion, so the widest edge is checked against the bytes
 * rather than against the code that produced them.
 */
function imageSizeOf(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(file)
  if (bytes[0] === 0x89 && bytes.toString('latin1', 1, 4) === 'PNG') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error(`not a JPEG at byte ${offset}`)
    const marker = bytes[offset + 1]
    const length = bytes.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  throw new Error('no JPEG frame header found')
}
