// ── The Run side of the promise: nothing deletes the data directory ──
//
// The ticket's central requirement is a promise about a directory, so it is
// proved by a real cycle on a temporary installation rather than by reading the
// code: migrate a checkout's data, run every filesystem step a Run performs
// (the Run logger, the Mirror mkdir, the downloads, the Gallery state write and
// its reader), and then assert that every file that was there before is still
// there, byte for byte, with the marker still in place. A Run may add and rewrite
// its state; it may not make anything vanish.
//
// This is not `core/main.ts` itself — that would go to the network — but it is
// the Run's whole data layer, with the same modules and the same paths.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { DataLayout } from '../../core/data-layout.js'
import { DATA_LAYOUT_VERSION, ensureDataLayout } from '../../core/data-layout.js'
import type { DownloadFetch, DownloadSite } from '../../core/download/download.js'
import { downloadBatch } from '../../core/download/download.js'
import type { GalleryList } from '../../core/gallery/gallery-source.js'
import {
  mergeGalleryStats,
  readGalleryState,
  writeGalleryState,
} from '../../core/gallery/gallery-state.js'
import { createLogger } from '../../core/logger.js'
import { createFileProbe, newestRunLogName } from '../../core/run-log-file.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function temporaryRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

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

/**
 * Assert every pre-existing file is still present, and byte-identical except
 * for the state files a Run is allowed to rewrite (never delete).
 */
function expectSurvivors(
  before: Map<string, Buffer>,
  after: Map<string, Buffer>,
  rewritable: readonly string[] = [],
): void {
  const mayChange = new Set(rewritable)
  for (const [relative, bytes] of before) {
    expect(after.has(relative), `${relative} must still exist`).toBe(true)
    if (mayChange.has(relative)) continue
    expect(after.get(relative)?.equals(bytes), `${relative} must be byte-identical`).toBe(true)
  }
}

/** A seed: the data layout an installation has before any new Run starts. */
function seededInstallation(prefix: string): {
  appRoot: string
  dataRoot: string
  data: DataLayout
} {
  const install = temporaryRoot(prefix)
  const appRoot = path.join(install, 'app')
  const dataRoot = path.join(install, 'data')
  fs.mkdirSync(appRoot)
  // The legacy checkout's data, so the cycle starts with a migration too.
  const write = (relative: string, bytes: string): void => {
    const file = path.join(appRoot, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes)
  }
  write(path.join('images', '1000_existing.jpg'), 'wallpaper-before')
  write(
    path.join('images', '.gallery-state.json'),
    JSON.stringify({
      version: 1,
      ids: [1000],
      updatedAt: '2026-10-20T00:10:00.000Z',
      runId: '2026-10-20T00-00-00',
    }),
  )
  write(path.join('logs', 'run-2026-10-20T00-00-00.jsonl'), '{"type":"run_meta"}\n')
  write(path.join('web', '.console-cache', 'thumbnails', '1000_existing.jpg'), 'thumb-before')
  write(path.join('data', 'user.env'), 'BATCH_SIZE=2\n')

  const result = ensureDataLayout({ appRoot, dataRoot })
  if (!result.ok) throw new Error(result.refusal.message)
  return { appRoot, dataRoot, data: result.ready.layout }
}

/**
 * The site inputs a Run passes to Download. They are explicit because the
 * download layer must not import the eager configuration: this test proves the
 * Run's data cycle with no `.env` at all.
 */
const SITE: DownloadSite = {
  baseOrigin: 'https://cdn.test',
  userAgent: 'Mozilla/5.0 (test)',
}

/** The network Download is given: one successful image, no socket. */
const fetchImpl: DownloadFetch = async () => ({
  status: 200,
  ok: true,
  arrayBuffer: async () => Uint8Array.from(Buffer.from('a-new-wallpaper')).buffer,
})

describe('a Run round trip over a temporary data directory', () => {
  it('adds and rewrites, but never removes, a single pre-existing file', async () => {
    const { dataRoot, data } = seededInstallation('data-run-survival-')
    const before = snapshot(dataRoot)
    expect(before.size).toBeGreaterThan(0)

    // 1. The Run logger opens the log directory and writes a record.
    const logger = createLogger(data.logDir)
    logger.info('run started')
    logger.info({ type: 'run_meta', runId: '2026-10-21T00-00-00' }, 'run_meta')

    // 2. The Mirror mkdir and a download, with the network injected.
    fs.mkdirSync(data.imagesDir, { recursive: true })
    const outcomes = await downloadBatch(
      ['https://cdn.test/20261021/1024_new.jpg'],
      data.imagesDir,
      1,
      SITE,
      logger,
      fetchImpl,
    )
    expect(outcomes[0]).toMatchObject({ kind: 'ok', filename: '1024_new.jpg' })

    // 3. The Gallery state write, and the same reader `check-run`/the Console use.
    // A moved `images/.gallery-state.json` with `version: 1` still reads: the
    // migration moves the file, it does not reinterpret its contents.
    expect(readGalleryState(data.galleryStateFile)?.runId).toBe('2026-10-20T00-00-00')
    const list: GalleryList = {
      total: 2,
      entries: [
        { id: 1000, url: 'https://cdn.test/20261020/1000_existing.jpg' },
        { id: 1024, url: 'https://cdn.test/20261021/1024_new.jpg' },
      ],
    }
    const { state } = mergeGalleryStats(
      readGalleryState(data.galleryStateFile),
      { list, diskFiles: fs.readdirSync(data.imagesDir) },
      '2026-10-21T00-00-00',
      '2026-10-21T00:10:00.000Z',
    )
    writeGalleryState(data.galleryStateFile, state)

    // 4. The readers the Run's verdict and the Console depend on.
    expect(newestRunLogName(data.logDir)).not.toBeNull()
    expect(createFileProbe(data.imagesDir)('1024_new.jpg')).toBe(true)
    expect(readGalleryState(data.galleryStateFile)?.runId).toBe('2026-10-21T00-00-00')

    // The promise: every file that existed before still exists. Only the
    // Gallery state is rewritten (a state file, forward-only); everything else,
    // the marker and the cache's old thumb included, is byte-identical.
    const after = snapshot(dataRoot)
    expectSurvivors(before, after, [path.join('images', '.gallery-state.json')])
    expect(after.get('layout.json')?.toString()).toContain(`"version": ${DATA_LAYOUT_VERSION}`)

    // And a second start is a no-op: no migration, no marker rewrite.
    const again = ensureDataLayout({
      appRoot: path.dirname(dataRoot),
      dataRoot,
    })
    expect(again).toMatchObject({ ok: true })
    if (!again.ok) throw new Error(again.refusal.message)
    expect(again.ready.markerWritten).toBe(false)
    expect(again.ready.migrated).toEqual([])
    expectSurvivors(after, snapshot(dataRoot))
  })
})
