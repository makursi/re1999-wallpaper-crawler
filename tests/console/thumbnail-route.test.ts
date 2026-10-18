import * as fs from 'node:fs'
import * as path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConsoleConfig } from '../../src/console/console-config.js'
import type { ThumbnailSource } from '../../src/console/server.js'
import { startConsoleServer } from '../../src/console/server.js'
import { IDLE_RUN_FACTS, UNREAD_GALLERY_FACTS } from '../../src/console/status.js'
import { THUMBNAIL_CACHE_DIR_NAME } from '../../src/console/thumbnails.js'
import type { GalleryList } from '../../src/gallery/gallery-source.js'
import { mergeGalleryStats } from '../../src/gallery/gallery-state.js'
import { consoleConfigIn, fixtureProjectRoot, TOKEN } from './run-fixtures.js'
import { writeTestImage } from './test-image.js'

const ON_DISK = '1013_8dee54e8bf644722981751524fb54356.png'
const NOT_ON_DISK = '1014_11a9938e23a347ca8580098ddfd5a190.jpg'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** The Gallery list the fixtures are checked against: two entries, one on disk. */
const GALLERY_LIST: GalleryList = {
  total: 2,
  entries: [
    {
      id: 1013,
      url: `https://gamecms-res.sl916.com/official_resource/PICTURE/20261007/${ON_DISK}`,
    },
    {
      id: 1014,
      url: `https://gamecms-res.sl916.com/official_resource/PICTURE/20261007/${NOT_ON_DISK}`,
    },
  ],
}

interface Fixture {
  config: ConsoleConfig
  cacheDir: string
}

/**
 * A repository standing in for the real one, built as data: a Mirror with one
 * image and the two non-image names the gap arithmetic has to keep counting.
 * The real `images/` is never read or written.
 */
async function fixture(): Promise<Fixture> {
  const root = fixtureProjectRoot('console-thumbnail-route-test-')
  roots.push(root)
  const config = consoleConfigIn(root)

  await writeTestImage(path.join(config.imagesDir, ON_DISK), 200, 400)
  fs.writeFileSync(path.join(config.imagesDir, 'notes.txt'), 'c')
  fs.writeFileSync(config.galleryStateFile, '{}')

  return { config, cacheDir: path.join(root, THUMBNAIL_CACHE_DIR_NAME) }
}

/**
 * A source that copies the Mirror's bytes into the cache. It stands in for the
 * real image library, so a route test needs no dependency on whether the native
 * addon works — and its call count is what "generated once, then served from
 * the cache" is observed through: the real source consults the cache before it
 * ever calls this function.
 */
function copyingSource(): ThumbnailSource & { generate: ReturnType<typeof vi.fn> } {
  const generate = vi.fn<(name: string, imagesDir: string, target: string) => Promise<void>>(
    async (name, imagesDir, target) => {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(imagesDir, name), target)
    },
  )
  return {
    generate,
    thumbnail: async (name, sourceFile) => {
      const imagesDir = path.dirname(sourceFile)
      const target = path.join(cacheDirFor(imagesDir), name)
      if (!fs.existsSync(target)) await generate(name, imagesDir, target)
      return fs.readFileSync(target)
    },
  }
}

/** The cache directory of the fixture this source belongs to. */
function cacheDirFor(imagesDir: string): string {
  return path.join(path.dirname(imagesDir), THUMBNAIL_CACHE_DIR_NAME)
}

async function serve(
  overrides: Partial<Parameters<typeof startConsoleServer>[1]> = {},
): Promise<{ service: Awaited<ReturnType<typeof startConsoleServer>>; fixture: Fixture }> {
  const built = await fixture()
  const service = await startConsoleServer(built.config, {
    runState: () => IDLE_RUN_FACTS,
    galleryFacts: () => UNREAD_GALLERY_FACTS,
    startRun: async () => ({ started: false, reason: 'starting a Run is not implemented yet' }),
    token: TOKEN,
    port: 0,
    ...overrides,
  })
  return { service, fixture: built }
}

interface RawImage {
  status: number
  bytes: Buffer
  headers: Headers
}

async function get(service: { origin: string }, urlPath: string): Promise<RawImage> {
  const response = await fetch(`${service.origin}${urlPath}`)
  return {
    status: response.status,
    bytes: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
  }
}

/** `readdirSync` plus each file's size: the Mirror as the Run report sees it. */
function mirrorState(imagesDir: string): string[] {
  return fs
    .readdirSync(imagesDir)
    .toSorted()
    .map(name => `${name}:${fs.statSync(path.join(imagesDir, name)).size}`)
}

/** The Run report's Mirror gap for a fixture, computed from its own listing. */
function mirrorGapOf(imagesDir: string) {
  const { stats } = mergeGalleryStats(
    null,
    { list: GALLERY_LIST, diskFiles: fs.readdirSync(imagesDir) },
    'run-1',
    '2026-10-18T00:00:00.000Z',
  )
  return stats.mirror
}

describe('GET /api/thumbnail/<name>', () => {
  it('generates one thumbnail at the pinned size, outside the Mirror', async () => {
    const source = copyingSource()
    const { service, fixture: built } = await serve({ thumbnailSource: source })
    const before = mirrorState(built.config.imagesDir)

    const first = await get(service, `/api/thumbnail/${ON_DISK}?token=${TOKEN}`)
    const second = await get(service, `/api/thumbnail/${ON_DISK}?token=${TOKEN}`)

    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toBe('image/png')
    expect(first.headers.get('x-content-type-options')).toBe('nosniff')
    expect(first.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    // The generator wrote the target, so the bytes are the Mirror's own: the
    // route serves the cache file, and the cache file is not in the Mirror.
    expect(first.bytes.equals(fs.readFileSync(path.join(built.config.imagesDir, ON_DISK)))).toBe(
      true,
    )
    expect(first.bytes.equals(second.bytes)).toBe(true)
    expect(source.generate).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(built.cacheDir)).toEqual([ON_DISK])
    expect(built.cacheDir.startsWith(built.config.imagesDir)).toBe(false)

    // Viewing changed nothing the Run report reads: the Mirror's listing and
    // every file's size, and the gap computed from them, are unchanged.
    expect(mirrorState(built.config.imagesDir)).toEqual(before)
    expect(mirrorGapOf(built.config.imagesDir)).toEqual({
      missingFromDisk: { count: 1, files: [NOT_ON_DISK] },
      extraOnDisk: { count: 1, files: ['notes.txt'] },
    })
  })

  it('refuses a malformed name with 400 before the generator is asked', async () => {
    const source = copyingSource()
    const { service } = await serve({ thumbnailSource: source })

    // Every one of them is refused, and never served from outside the Mirror.
    // The encoded forms are the interesting half: WHATWG URL
    // leaves them in the pathname, so only a single decode plus these checks
    // turns them into the `/api/status` they would otherwise reach.
    const malformed = [
      '%2e%2e%2fpackage.json',
      '%2e%2e%2f..%2fpackage.json',
      '%2e%2e%2f..%2f..%2fpackage.json',
      '..%5C..%5Cpackage.json',
      '....//....//config.ts',
      '%2fetc/passwd',
      'sub%2f1013_hash.jpg',
      'sub/1013_hash.jpg',
      'C:%5CWindows%5Cwin.ini',
      '%5C%5Cserver%5Cshare%5Cevil.jpg',
      'C:evil.png',
      `${ON_DISK}:ads`,
      'bad%00name.png',
      '%00.png',
      '.gallery-state.json',
      '%2egallery-state.json',
      'notes.txt',
      '%',
      '%zz.png',
      '',
    ]

    for (const name of malformed) {
      const response = await get(service, `/api/thumbnail/${name}?token=${TOKEN}`)
      expect(response.status, `name ${JSON.stringify(name)}`).toBe(400)
      expect(JSON.parse(response.bytes.toString())).toEqual({ error: 'invalid name' })
    }

    // A plain `..` never reaches the route at all: `new URL` collapses it, so
    // the request is some other path and the router answers its own 404. Either
    // way it is refused, and no file outside the Mirror is served.
    for (const name of ['..', '../package.json']) {
      const response = await get(service, `/api/thumbnail/${name}?token=${TOKEN}`)
      expect(response.status, `name ${JSON.stringify(name)}`).toBe(404)
    }

    expect(source.generate).toHaveBeenCalledTimes(0)
  })

  it('answers 404 {"error":"missing file"} for a well-formed name that is not on disk', async () => {
    const source = copyingSource()
    const { service, fixture: built } = await serve({ thumbnailSource: source })

    const response = await get(service, `/api/thumbnail/${NOT_ON_DISK}?token=${TOKEN}`)

    // The AC's exact requirement: a missing file, not a server error. The
    // existence check is the 404/500 boundary, so sharp is never reached.
    expect(response.status).toBe(404)
    expect(JSON.parse(response.bytes.toString())).toEqual({ error: 'missing file' })
    expect(source.generate).toHaveBeenCalledTimes(0)
    expect(fs.existsSync(built.cacheDir) ? fs.readdirSync(built.cacheDir) : []).toEqual([])
  })

  it('answers 500 when the image library cannot render, and the process survives', async () => {
    const source: ThumbnailSource = {
      thumbnail: vi.fn<ThumbnailSource['thumbnail']>(async () => {
        throw new Error('Could not load the "sharp" module using the win32-x64 runtime')
      }),
    }
    const { service, fixture: built } = await serve({ thumbnailSource: source })

    const response = await get(service, `/api/thumbnail/${ON_DISK}?token=${TOKEN}`)
    // The service is still answering afterwards: a broken native binary is a
    // named 500 for one tile, not a crashed Console.
    const status = await get(service, `/api/status?token=${TOKEN}`)

    expect(response.status).toBe(500)
    expect(JSON.parse(response.bytes.toString())).toEqual({ error: 'thumbnail failed' })
    expect(status.status).toBe(200)
    // Nothing is cached for a name that failed, so the next request retries.
    expect(fs.existsSync(built.cacheDir) ? fs.readdirSync(built.cacheDir) : []).toEqual([])
  })

  it('is behind the request guard, and only answers GET', async () => {
    const source = copyingSource()
    const { service } = await serve({ thumbnailSource: source })

    expect((await fetch(`${service.origin}/api/thumbnail/${ON_DISK}`)).status).toBe(403)
    expect((await fetch(`${service.origin}/api/thumbnail/${ON_DISK}?token=wrong`)).status).toBe(403)
    expect(
      (await fetch(`${service.origin}/api/thumbnail/${ON_DISK}?token=${TOKEN}`, { method: 'POST' }))
        .status,
    ).toBe(405)
  })
})

describe('GET /api/image/<name>', () => {
  it('serves the original file', async () => {
    const { service, fixture: built } = await serve()
    const original = fs.readFileSync(path.join(built.config.imagesDir, ON_DISK))

    const response = await get(service, `/api/image/${ON_DISK}?token=${TOKEN}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.bytes.equals(original)).toBe(true)
  })

  it('answers 404 for a well-formed name that is not on disk, and 400 for a malformed one', async () => {
    const { service } = await serve()

    const missing = await get(service, `/api/image/${NOT_ON_DISK}?token=${TOKEN}`)
    const malformed = await get(service, `/api/image/..%2Fpackage.json?token=${TOKEN}`)

    expect(missing.status).toBe(404)
    expect(JSON.parse(missing.bytes.toString())).toEqual({ error: 'missing file' })
    expect(malformed.status).toBe(400)
    expect(JSON.parse(malformed.bytes.toString())).toEqual({ error: 'invalid name' })
  })

  it('is behind the request guard, and only answers GET', async () => {
    const { service } = await serve()

    expect((await fetch(`${service.origin}/api/image/${ON_DISK}`)).status).toBe(403)
    expect(
      (await fetch(`${service.origin}/api/image/${ON_DISK}?token=${TOKEN}`, { method: 'POST' }))
        .status,
    ).toBe(405)
  })
})

describe('the thumbnail route with no image library', () => {
  it('answers 500 rather than crashing when the service was given no source', async () => {
    const { service } = await serve()

    const response = await get(service, `/api/thumbnail/${ON_DISK}?token=${TOKEN}`)

    expect(response.status).toBe(500)
    expect(JSON.parse(response.bytes.toString())).toEqual({ error: 'thumbnail failed' })
  })
})
