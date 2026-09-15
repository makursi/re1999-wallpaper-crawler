import { describe, expect, it, vi } from 'vitest'

import {
  GallerySourceError,
  falsePositivesAmong,
  fetchGalleryList,
  officialNamesOf,
  parseGalleryList,
} from '../../src/gallery/gallery-source.js'
import type { GalleryList } from '../../src/gallery/gallery-source.js'

const CDN = 'https://gamecms-res.sl916.com/official_website_resource/50001/4/PICTURE'

const payload = {
  code: 200,
  msg: '成功',
  data: {
    total: 2,
    current: 1,
    pageSize: 2000,
    pageData: [
      {
        id: 1012,
        title: '1012.竖版-2560x1440',
        pictureUrl: 'https://cdn/PICTURE/20260907/1012.jpg',
      },
      { id: 1011, title: null, pictureUrl: 'https://cdn/PICTURE/20260907/1011.jpg' },
    ],
  },
}

/** A real Response, so the tests exercise the same surface the caller does. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('parseGalleryList', () => {
  it('reads the total and every entry from a well-formed payload', () => {
    expect(parseGalleryList(payload)).toEqual({
      total: 2,
      entries: [
        { id: 1012, url: 'https://cdn/PICTURE/20260907/1012.jpg' },
        { id: 1011, url: 'https://cdn/PICTURE/20260907/1011.jpg' },
      ],
    })
  })

  it('refuses a list that is shorter than its own total', () => {
    const short = { ...payload, data: { ...payload.data, total: 1001 } }
    expect(() => parseGalleryList(short)).toThrow(GallerySourceError)
    expect(() => parseGalleryList(short)).toThrow(/incomplete list: 2 of 1001/)
  })

  it('refuses a non-200 business code', () => {
    expect(() => parseGalleryList({ ...payload, code: 500 })).toThrow(/answered code 500/)
  })

  it('refuses a payload whose shape it does not recognise', () => {
    expect(() => parseGalleryList({ hello: 'world' })).toThrow(GallerySourceError)
    expect(() => parseGalleryList(null)).toThrow(GallerySourceError)
  })
})

describe('officialNamesOf', () => {
  it('is the name set the mirror check and the filter check share', () => {
    const list: GalleryList = {
      total: 1,
      entries: [{ id: 996, url: `${CDN}/20260729/996.%E7%AB%96%E7%89%88-2560x1440_abc.jpg` }],
    }
    expect(officialNamesOf(list)).toEqual(new Set(['996.竖版-2560x1440_abc.jpg']))
  })
})

describe('falsePositivesAmong', () => {
  const list: GalleryList = { total: 1, entries: [{ id: 1012, url: `${CDN}/20260907/1012.jpg` }] }

  it('flags only the dropped URLs the list calls Wallpapers', () => {
    expect(
      falsePositivesAmong(['https://hm.baidu.com/hm.gif?rnd=1', `${CDN}/20260907/1012.jpg`], list),
    ).toEqual([`${CDN}/20260907/1012.jpg`])
  })

  it('matches a percent-encoded capture against the list', () => {
    const encoded: GalleryList = {
      total: 1,
      entries: [{ id: 996, url: `${CDN}/20260729/996.%E7%AB%96%E7%89%88-2560x1440_abc.jpg` }],
    }
    expect(falsePositivesAmong([`${CDN}/20260729/996.竖版-2560x1440_abc.jpg`], encoded)).toEqual([
      `${CDN}/20260729/996.竖版-2560x1440_abc.jpg`,
    ])
  })

  it('reports that nothing was checked when the list was unavailable', () => {
    expect(falsePositivesAmong([`${CDN}/20260907/1012.jpg`], null)).toBeNull()
  })
})

describe('fetchGalleryList', () => {
  const endpoint = 'https://re.bluepoch.com/activity/official/websites/picture/query'

  it('asks for the whole list in one request and returns it parsed', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(payload))
    const list = await fetchGalleryList({ endpoint, fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(endpoint)
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ current: 1, pageSize: 2000 }))
    expect(list.total).toBe(2)
  })

  it('fails loudly when the endpoint answers with an HTTP error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 503))
    await expect(fetchGalleryList({ endpoint, fetchImpl })).rejects.toThrow(/HTTP 503/)
  })

  it('fails loudly when the endpoint cannot be reached', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    })
    await expect(fetchGalleryList({ endpoint, fetchImpl })).rejects.toThrow(GallerySourceError)
  })
})
