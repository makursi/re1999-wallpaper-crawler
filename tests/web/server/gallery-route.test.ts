import * as fs from 'node:fs'
import * as path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GalleryList } from '../../../core/gallery/gallery-source.js'
import { GallerySourceError } from '../../../core/gallery/gallery-source.js'
import type { ConsoleConfig } from '../../../web/server/console-config.js'
import type { GalleryListSource } from '../../../web/server/gallery-list-source.js'
import { createGalleryListSource } from '../../../web/server/gallery-list-source.js'
import type { ConsoleServerDeps, ConsoleService } from '../../../web/server/server.js'
import { startConsoleServer } from '../../../web/server/server.js'
import { galleryFactsOf, IDLE_RUN_FACTS } from '../../../web/server/status.js'
import { consoleConfigIn, fixtureProjectRoot, TOKEN } from './run-fixtures.js'

const CDN = 'https://gamecms-res.sl916.com/official_website_resource/50001/4/PICTURE'
const RETIRED = '978.竖版-2560x1440_61032b056992416faaf041b01d7c1633.jpg'

const roots: string[] = []
const openServices: ConsoleService[] = []

afterEach(async () => {
  await Promise.all(openServices.splice(0).map(service => service.close()))
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** A directory tree standing in for the repository, built as data. */
function fixture(): ConsoleConfig {
  const projectRoot = fixtureProjectRoot('console-gallery-test-')
  roots.push(projectRoot)
  const config = consoleConfigIn(projectRoot)

  fs.writeFileSync(path.join(config.imagesDir, '1012_hash.jpg'), 'a')
  fs.writeFileSync(path.join(config.imagesDir, RETIRED), 'b')
  fs.writeFileSync(path.join(config.imagesDir, 'notes.txt'), 'c')
  fs.writeFileSync(config.galleryStateFile, '{}')

  return config
}

/** The list the site would answer: 1012 is on disk, 1011 is not. */
const LIST: GalleryList = {
  total: 2,
  entries: [
    { id: 1012, url: `${CDN}/20261007/1012_hash.jpg` },
    { id: 1011, url: `${CDN}/20261007/1011_hash.jpg` },
  ],
}

/**
 * The service with one `GalleryListSource` behind it: `galleryFacts` (the
 * status half) and `galleryList` (the route's half) have to be the same source,
 * or `/api/status` and `/api/gallery` would describe different reads.
 */
async function serve(
  fetchList: () => Promise<GalleryList>,
  overrides: Partial<ConsoleServerDeps> = {},
): Promise<{ service: ConsoleService; fetchList: ReturnType<typeof vi.fn> }> {
  const spy = vi.fn<() => Promise<GalleryList>>(fetchList)
  const source: GalleryListSource = createGalleryListSource({ fetchList: spy })

  const service = await startConsoleServer(fixture(), {
    runState: () => IDLE_RUN_FACTS,
    galleryFacts: async () => galleryFactsOf(await source.get()),
    galleryList: source,
    newSinceLastRun: () => 12,
    startRun: async () => ({ started: false, reason: 'starting a Run is not implemented yet' }),
    token: TOKEN,
    port: 0,
    ...overrides,
  })
  openServices.push(service)
  return { service, fetchList: spy }
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url)
  return { status: response.status, body: await response.json() }
}

describe('GET /api/gallery', () => {
  it('answers one row per list entry plus the Mirror extras, with the counts', async () => {
    const { service } = await serve(async () => LIST)

    const { status, body } = await getJson(`${service.origin}/api/gallery?token=${TOKEN}`)

    expect(status).toBe(200)
    expect(body).toEqual({
      rows: [
        { id: 1012, name: '1012_hash.jpg', state: 'on-disk' },
        { id: 1011, name: '1011_hash.jpg', state: 'missing' },
        { id: null, name: RETIRED, state: 'not-in-gallery' },
        { id: null, name: 'notes.txt', state: 'not-in-gallery' },
      ],
      officialTotal: 2,
      newSinceLastRun: 12,
      listAvailable: true,
      mirrorGap: { missing: 1, extra: 2 },
      // Every non-dot Mirror name: the image, the retired file, notes.txt.
      mirrorCount: 3,
    })
  })

  it('serves the status and the gallery from one read of the list', async () => {
    const { service, fetchList } = await serve(async () => LIST)

    const status = await getJson(`${service.origin}/api/status?token=${TOKEN}`)
    const gallery = await getJson(`${service.origin}/api/gallery?token=${TOKEN}`)

    expect(status.body).toMatchObject({ officialTotal: 2, listAvailable: true })
    expect(gallery.body).toMatchObject({ officialTotal: 2, listAvailable: true })
    expect(fetchList).toHaveBeenCalledTimes(1)
  })

  it('degrades to the Mirror alone when the list fetch is refused, rather than 500', async () => {
    const { service } = await serve(async () => {
      throw new GallerySourceError('list endpoint unreachable: getaddrinfo ENOTFOUND')
    })

    const { status, body } = await getJson(`${service.origin}/api/gallery?token=${TOKEN}`)
    const statusPayload = await getJson(`${service.origin}/api/status?token=${TOKEN}`)

    expect(status).toBe(200)
    expect(body).toEqual({
      rows: [
        { id: null, name: '1012_hash.jpg', state: 'on-disk' },
        { id: null, name: RETIRED, state: 'on-disk' },
        { id: null, name: 'notes.txt', state: 'on-disk' },
      ],
      officialTotal: null,
      newSinceLastRun: 12,
      listAvailable: false,
      // "Not checked" is never "nothing missing".
      mirrorGap: null,
      mirrorCount: 3,
    })
    // The status view takes the same stance.
    expect(statusPayload.body).toMatchObject({ officialTotal: null, listAvailable: false })
  })

  it('is behind the request guard and refuses a write method', async () => {
    const { service } = await serve(async () => LIST)

    expect((await fetch(`${service.origin}/api/gallery`)).status).toBe(403)

    const response = await fetch(`${service.origin}/api/gallery?token=${TOKEN}`, { method: 'POST' })

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })
})

describe('the gallery route without a list source', () => {
  it('degrades instead of failing when the service was given none', async () => {
    // #32's status-only shape: no `galleryList` dep at all.
    const source: GalleryListSource = createGalleryListSource({ fetchList: async () => LIST })
    const service = await startConsoleServer(fixture(), {
      runState: () => IDLE_RUN_FACTS,
      galleryFacts: async () => galleryFactsOf(await source.get()),
      startRun: async () => ({ started: false, reason: 'not implemented yet' }),
      token: TOKEN,
      port: 0,
    })
    openServices.push(service)

    const { status, body } = await getJson(`${service.origin}/api/gallery?token=${TOKEN}`)

    expect(status).toBe(200)
    expect(body).toMatchObject({ listAvailable: false, officialTotal: null, mirrorGap: null })
  })
})
