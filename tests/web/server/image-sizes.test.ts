// ── The sizes the wall is balanced against, as data ─────────────────
//
// Ticket #48's service half: the gallery route sends each Wallpaper's own pixel
// size so the masonry can place a tile before its lazy thumbnail arrives. The
// reading is injected here (`fileOf`, `sizeOf`), so what is under test is the
// collector's policy — what it skips, what it remembers and how wide it runs —
// and never an image on disk.

import { describe, expect, it, vi } from 'vitest'

import type { ImageSizeReader } from '../../../web/server/image-sizes.js'
import {
  createImageSizeCache,
  IMAGE_SIZE_CONCURRENCY,
  imageSizesOf,
} from '../../../web/server/image-sizes.js'

/** The trivial case: a name is its own file, and every read succeeds. */
const byName: (name: string) => string | null = name => name

const square: ImageSizeReader = async () => ({ width: 10, height: 20 })

describe('imageSizesOf', () => {
  it('returns one size per measurable name, keyed by the name the page asks with', async () => {
    const sizes = await imageSizesOf(['a.jpg', 'b.jpg'], byName, async () => ({
      width: 1440,
      height: 2560,
    }))

    expect(sizes).toEqual({
      'a.jpg': { width: 1440, height: 2560 },
      'b.jpg': { width: 1440, height: 2560 },
    })
  })

  it('skips a name the Mirror would not serve, without asking the reader for it', async () => {
    const read = vi.fn<ImageSizeReader>(square)
    const sizes = await imageSizesOf(
      ['a.jpg', 'notes.txt'],
      name => (name === 'notes.txt' ? null : name),
      read,
    )

    expect(sizes).toEqual({ 'a.jpg': { width: 10, height: 20 } })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('drops a file the reader cannot measure rather than failing the whole wall', async () => {
    const sizes = await imageSizesOf(['good.jpg', 'broken.jpg'], byName, async file => {
      if (file === 'broken.jpg') throw new Error('not an image')
      return { width: 10, height: 20 }
    })

    // "Not measured" is absent, never `0 × 0`: the page's fallback is a
    // proportion, and a zero-sized tile would break the masonry instead.
    expect(sizes).toEqual({ 'good.jpg': { width: 10, height: 20 } })
    expect(sizes['broken.jpg']).toBeUndefined()
  })

  it('holds no more than the ceiling of reads in flight at once', async () => {
    let inFlight = 0
    let peak = 0
    const read: ImageSizeReader = async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight -= 1
      return { width: 1, height: 1 }
    }
    const names = Array.from({ length: 20 }, (_, index) => `${index}.jpg`)

    const sizes = await imageSizesOf(names, byName, read, 3)

    expect(Object.keys(sizes)).toHaveLength(20)
    expect(peak).toBe(3)
  })

  it('runs wider by default than a sequential pass, and says how wide', () => {
    expect(IMAGE_SIZE_CONCURRENCY).toBeGreaterThan(1)
  })

  it('answers an empty wall with an empty map rather than hanging on no workers', async () => {
    await expect(imageSizesOf([], byName, square)).resolves.toEqual({})
  })
})

describe('createImageSizeCache', () => {
  it('reads a file once and answers every later ask from the memo', async () => {
    const read = vi.fn<ImageSizeReader>(square)
    const sizeOf = createImageSizeCache(read)

    expect(await sizeOf('a.jpg')).toEqual({ width: 10, height: 20 })
    expect(await sizeOf('a.jpg')).toEqual({ width: 10, height: 20 })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('shares one read between asks that arrive together, rather than starting two', async () => {
    const read = vi.fn<ImageSizeReader>(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return { width: 10, height: 20 }
    })
    const sizeOf = createImageSizeCache(read)

    const [first, second] = await Promise.all([sizeOf('a.jpg'), sizeOf('a.jpg')])

    expect(first).toEqual(second)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not remember a failure, so a file that comes back is measured next time', async () => {
    const read = vi
      .fn<ImageSizeReader>()
      .mockRejectedValueOnce(new Error('no such file'))
      .mockResolvedValue({ width: 10, height: 20 })
    const sizeOf = createImageSizeCache(read)

    await expect(sizeOf('a.jpg')).rejects.toThrow('no such file')
    await expect(sizeOf('a.jpg')).resolves.toEqual({ width: 10, height: 20 })
    expect(read).toHaveBeenCalledTimes(2)
  })
})
