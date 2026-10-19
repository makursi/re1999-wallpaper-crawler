import { describe, expect, it, vi } from 'vitest'

import type { GalleryList } from '../../../core/gallery/gallery-source.js'
import { GallerySourceError } from '../../../core/gallery/gallery-source.js'
import { createGalleryListSource } from '../../../web/server/gallery-list-source.js'

const list: GalleryList = {
  total: 1,
  entries: [{ id: 1012, url: 'https://gamecms-res.sl916.com/20261007/1012_hash.jpg' }],
}

/** A hand-cranked clock, so the TTL needs no real waiting. */
function clock(start = 0) {
  let now = start
  return {
    now: () => now,
    advance: (ms: number): void => {
      now += ms
    },
  }
}

describe('createGalleryListSource', () => {
  it('reads once and serves the cached list inside the TTL', async () => {
    const time = clock()
    const fetchList = vi.fn<() => Promise<GalleryList>>(async () => list)
    const source = createGalleryListSource({ fetchList, ttlMs: 60_000, now: time.now })

    expect(await source.get()).toBe(list)

    time.advance(59_999)
    expect(await source.get()).toBe(list)
    expect(fetchList).toHaveBeenCalledTimes(1)
  })

  it('reads again once the TTL has passed', async () => {
    const time = clock()
    const fetchList = vi.fn<() => Promise<GalleryList>>(async () => list)
    const source = createGalleryListSource({ fetchList, ttlMs: 60_000, now: time.now })

    await source.get()

    time.advance(60_000)
    await source.get()

    expect(fetchList).toHaveBeenCalledTimes(2)
  })

  it('defaults to a one-minute TTL', async () => {
    const time = clock()
    const fetchList = vi.fn<() => Promise<GalleryList>>(async () => list)
    const source = createGalleryListSource({ fetchList, now: time.now })

    await source.get()
    time.advance(59_999)
    await source.get()
    expect(fetchList).toHaveBeenCalledTimes(1)

    time.advance(1)
    await source.get()
    expect(fetchList).toHaveBeenCalledTimes(2)
  })

  it('remembers a failed read for the TTL instead of rejecting', async () => {
    const time = clock()
    const fetchList = vi.fn<() => Promise<GalleryList>>(async () => {
      throw new GallerySourceError('list endpoint unreachable: getaddrinfo ENOTFOUND')
    })
    const source = createGalleryListSource({ fetchList, ttlMs: 60_000, now: time.now })

    await expect(source.get()).resolves.toBeNull()

    time.advance(59_999)
    await expect(source.get()).resolves.toBeNull()
    expect(fetchList).toHaveBeenCalledTimes(1)
  })

  it('tries again once the TTL has passed, so a recovered endpoint is served', async () => {
    const time = clock()
    const fetchList = vi
      .fn<() => Promise<GalleryList>>()
      .mockRejectedValueOnce(new GallerySourceError('list endpoint unreachable: down'))
      .mockResolvedValue(list)
    const source = createGalleryListSource({ fetchList, ttlMs: 1_000, now: time.now })

    await expect(source.get()).resolves.toBeNull()

    time.advance(1_000)
    await expect(source.get()).resolves.toBe(list)
    expect(fetchList).toHaveBeenCalledTimes(2)
  })
})
