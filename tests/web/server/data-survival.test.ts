// ── The Console side of the promise: a Status cycle deletes nothing ──
//
// #80's central requirement is that no startup or view ever removes the user's
// data, so it is proved as a behaviour: build a temporary installation, run the
// real service over it, drive every data-touching route (status, gallery, image,
// thumbnail and a refused Run start), and then assert that every file that
// existed before still exists, byte for byte. The Console may add a thumbnail to
// the cache — that is the one thing it writes — but nothing may disappear.
//
// The real checkout's 2.1 GB `images/` is never read: the whole cycle is over
// `fixtureAppRoot`'s temporary tree.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { GalleryList } from '../../../core/gallery/gallery-source.js'
import { createGalleryListSource } from '../../../web/server/gallery-list-source.js'
import { createRunLogSource } from '../../../web/server/run-log-source.js'
import type { ConsoleService, ThumbnailSource } from '../../../web/server/server.js'
import { startConsoleServer } from '../../../web/server/server.js'
import { galleryFactsOf } from '../../../web/server/status.js'
import {
  consoleConfigIn,
  fixtureAppRoot,
  galleryState,
  LOG_NAME,
  plainLine,
  runLog,
  runReport,
  TOKEN,
} from './run-fixtures.js'

const ON_DISK = '1013_8dee54e8bf644722981751524fb54356.png'
const MISSING = '1014_11a9938e23a347ca8580098ddfd5a190.jpg'

const roots: string[] = []
const services: ConsoleService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.close()))
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** Every file under `root`, relative to it, with its exact bytes. */
function snapshot(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else files.set(path.relative(root, absolute), fs.readFileSync(absolute))
    }
  }
  walk(root)
  return files
}

/** Assert every pre-existing file is still present with identical bytes. */
function expectSurvivors(before: Map<string, Buffer>, after: Map<string, Buffer>): void {
  for (const [relative, bytes] of before) {
    expect(after.has(relative), `${relative} must still exist`).toBe(true)
    expect(after.get(relative)?.equals(bytes), `${relative} must be byte-identical`).toBe(true)
  }
}

const LIST: GalleryList = {
  total: 2,
  entries: [
    { id: 1013, url: `https://cdn.test/20261007/${ON_DISK}` },
    { id: 1014, url: `https://cdn.test/20261007/${MISSING}` },
  ],
}

describe('a Console Status cycle over a temporary data directory', () => {
  it('serves every data route and leaves the pre-existing tree intact', async () => {
    const appRoot = fixtureAppRoot('console-data-survival-')
    roots.push(appRoot)
    const config = consoleConfigIn(appRoot)

    // The installation as the user has it: a Mirror, a Run log, Gallery state,
    // a cached thumbnail and the layout marker.
    fs.writeFileSync(path.join(config.imagesDir, ON_DISK), 'wallpaper')
    fs.writeFileSync(path.join(config.imagesDir, 'notes.txt'), 'c')
    fs.writeFileSync(config.galleryStateFile, JSON.stringify(galleryState()), 'utf8')
    fs.writeFileSync(
      path.join(config.logDir, LOG_NAME),
      `${runLog(plainLine('done'), JSON.stringify(runReport()))}\n`,
      'utf8',
    )
    fs.mkdirSync(config.cacheDir, { recursive: true })
    fs.writeFileSync(path.join(config.cacheDir, ON_DISK), 'old-thumb')
    fs.writeFileSync(
      path.join(config.dataRoot, 'layout.json'),
      `${JSON.stringify({ version: 1 })}\n`,
      'utf8',
    )

    const runState = createRunLogSource({
      logDir: config.logDir,
      galleryStateFile: config.galleryStateFile,
      imagesDir: config.imagesDir,
      liveChild: () => false,
    })
    const galleryList = createGalleryListSource({ fetchList: async () => LIST })
    const thumbnailSource: ThumbnailSource = {
      thumbnail: async (name, sourceFile) => {
        const target = path.join(config.cacheDir, name)
        fs.mkdirSync(config.cacheDir, { recursive: true })
        if (!fs.existsSync(target)) fs.copyFileSync(sourceFile, target)
        return fs.readFileSync(target)
      },
    }

    const service = await startConsoleServer(config, {
      runState: () => runState.facts(),
      galleryFacts: async () => galleryFactsOf(await galleryList.get()),
      galleryList,
      newSinceLastRun: () => 1,
      thumbnailSource,
      startRun: async () => ({
        started: false,
        refusal: { code: 'run-busy', missing: [] },
        status: 409,
      }),
      token: TOKEN,
      port: 0,
    })
    services.push(service)

    const before = snapshot(config.dataRoot)
    expect(before.size).toBeGreaterThan(0)

    const status = await fetch(`${service.origin}/api/status?token=${TOKEN}`)
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({ mirrorCount: 2, reportPresent: true })

    const gallery = await fetch(`${service.origin}/api/gallery?token=${TOKEN}`)
    expect(gallery.status).toBe(200)
    expect(await gallery.json()).toMatchObject({
      rows: expect.arrayContaining([expect.objectContaining({ name: ON_DISK })]),
    })

    const image = await fetch(`${service.origin}/api/image/${ON_DISK}?token=${TOKEN}`)
    expect(image.status).toBe(200)
    expect(Buffer.from(await image.arrayBuffer()).toString()).toBe('wallpaper')

    const thumbnail = await fetch(`${service.origin}/api/thumbnail/${ON_DISK}?token=${TOKEN}`)
    expect(thumbnail.status).toBe(200)
    // The pre-existing cache entry is what the route serves, unchanged; the
    // cycle cannot have blanked the cache that an update used to throw away.
    expect(await thumbnail.text()).toBe('old-thumb')
    // The cache is outside the Mirror, and the old thumb it held is untouched.
    expect(config.cacheDir.startsWith(config.imagesDir)).toBe(false)

    const refusedStart = await fetch(`${service.origin}/api/run?token=${TOKEN}`, {
      method: 'POST',
    })
    expect(refusedStart.status).toBe(409)

    // A second read must be just as harmless as the first.
    expect((await fetch(`${service.origin}/api/status?token=${TOKEN}`)).status).toBe(200)

    expect(fs.existsSync(config.dataRoot)).toBe(true)
    expectSurvivors(before, snapshot(config.dataRoot))
  })
})
