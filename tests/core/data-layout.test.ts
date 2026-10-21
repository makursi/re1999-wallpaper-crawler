import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DATA_LAYOUT_VERSION,
  dataLayoutOf,
  ensureDataLayout,
  layoutRefusalOf,
  readDataLayoutMarker,
} from '../../core/data-layout.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function temporaryRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

/** A packaged installation: `<install>/app` beside `<install>/data`. */
function installation(prefix: string): { appRoot: string; dataRoot: string } {
  const install = temporaryRoot(prefix)
  const appRoot = path.join(install, 'app')
  const dataRoot = path.join(install, 'data')
  fs.mkdirSync(appRoot, { recursive: true })
  return { appRoot, dataRoot }
}

/** Every file under `root`, relative to it, with its bytes — a tree snapshot. */
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else files[path.relative(root, absolute)] = fs.readFileSync(absolute).toString('base64')
    }
  }
  walk(root)
  return files
}

/** Write a file, creating its parent directories. */
function write(file: string, text = 'x'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}

describe('dataLayoutOf', () => {
  it('places the Mirror, the Run logs and the thumbnails under the injected data root', () => {
    const { appRoot, dataRoot } = installation('data-layout-paths-')

    expect(dataLayoutOf({ appRoot, dataRoot })).toEqual({
      appRoot,
      dataRoot,
      markerFile: path.join(dataRoot, 'layout.json'),
      imagesDir: path.join(dataRoot, 'images'),
      logDir: path.join(dataRoot, 'logs'),
      cacheDir: path.join(dataRoot, 'cache', 'thumbnails'),
      galleryStateFile: path.join(dataRoot, 'images', '.gallery-state.json'),
    })
  })

  it('keeps the Mirror path configurable, resolved against the data root', () => {
    const { appRoot, dataRoot } = installation('data-layout-configurable-')

    const layout = dataLayoutOf({ appRoot, dataRoot, configuredImagesDir: 'mirror' })

    expect(layout.imagesDir).toBe(path.join(dataRoot, 'mirror'))
    expect(layout.galleryStateFile).toBe(path.join(dataRoot, 'mirror', '.gallery-state.json'))
  })

  it('takes the data root as an input, never as a sibling of the app root by deduction', () => {
    // A source tree's app root is the repository and its data is `<repo>/data`;
    // the package's data is beside `<install>/app`. Both arrive as parameters.
    const { appRoot } = installation('data-layout-input-')
    const elsewhere = path.join(temporaryRoot('data-layout-elsewhere-'), 'data')

    expect(dataLayoutOf({ appRoot, dataRoot: elsewhere }).imagesDir).toBe(
      path.join(elsewhere, 'images'),
    )
  })

  it('keeps the thumbnail cache outside the Mirror', () => {
    const { appRoot, dataRoot } = installation('data-layout-cache-')
    const layout = dataLayoutOf({ appRoot, dataRoot })

    expect(layout.cacheDir.startsWith(layout.imagesDir)).toBe(false)
    expect(layout.cacheDir.startsWith(dataRoot)).toBe(true)
  })
})

describe('readDataLayoutMarker', () => {
  it('answers absent for a data directory that has never been written', () => {
    const { dataRoot } = installation('data-layout-marker-absent-')

    expect(readDataLayoutMarker(path.join(dataRoot, 'layout.json'))).toEqual({ kind: 'absent' })
  })

  it('reads the current layout version', () => {
    const { dataRoot } = installation('data-layout-marker-current-')
    const file = path.join(dataRoot, 'layout.json')
    write(file, `${JSON.stringify({ version: DATA_LAYOUT_VERSION })}\n`)

    expect(readDataLayoutMarker(file)).toEqual({ kind: 'version', version: DATA_LAYOUT_VERSION })
  })

  it.each([
    ['not JSON at all', 'not json'],
    ['an object without a version', '{}'],
    ['a stringly-typed version', '{"version":"1"}'],
    ['a fractional version', '{"version":1.5}'],
    ['a negative version', '{"version":-1}'],
  ])('answers invalid for %s', (_label, text) => {
    const { dataRoot } = installation('data-layout-marker-invalid-')
    const file = path.join(dataRoot, 'layout.json')
    write(file, text)

    expect(readDataLayoutMarker(file)).toMatchObject({ kind: 'invalid' })
  })
})

describe('layoutRefusalOf', () => {
  it('accepts an absent marker and the current version', () => {
    const { dataRoot } = installation('data-layout-refusal-current-')
    const file = path.join(dataRoot, 'layout.json')

    expect(layoutRefusalOf(file)).toBeNull()

    write(file, `${JSON.stringify({ version: DATA_LAYOUT_VERSION })}\n`)
    expect(layoutRefusalOf(file)).toBeNull()
  })

  it('refuses a newer layout with a Chinese explanation that names both versions', () => {
    const { dataRoot } = installation('data-layout-refusal-newer-')
    const file = path.join(dataRoot, 'layout.json')
    write(file, `${JSON.stringify({ version: DATA_LAYOUT_VERSION + 1 })}\n`)

    const refusal = layoutRefusalOf(file)

    expect(refusal).toMatchObject({ code: 'newer-layout' })
    expect(refusal?.message).toContain('数据')
    expect(refusal?.message).toContain(String(DATA_LAYOUT_VERSION + 1))
    expect(refusal?.message).toContain(String(DATA_LAYOUT_VERSION))
    expect(refusal?.message).toContain(file)
    expect(refusal?.message).toContain('没有改动')
  })

  it('refuses an unknown marker with a Chinese explanation, rather than guessing', () => {
    const { dataRoot } = installation('data-layout-refusal-unknown-')
    const file = path.join(dataRoot, 'layout.json')
    write(file, '{}')

    const refusal = layoutRefusalOf(file)

    expect(refusal).toMatchObject({ code: 'unknown-layout' })
    expect(refusal?.message).toContain('数据')
    expect(refusal?.message).toContain(file)
    expect(refusal?.message).toContain('没有改动')
  })
})

describe('ensureDataLayout', () => {
  it('creates a fresh data directory with a version-1 marker and moves nothing', () => {
    const { appRoot, dataRoot } = installation('data-layout-fresh-')

    const result = ensureDataLayout({ appRoot, dataRoot })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.refusal.message)
    expect(result.ready.migrated).toEqual([])
    expect(result.ready.markerWritten).toBe(true)
    expect(fs.readFileSync(path.join(dataRoot, 'layout.json'), 'utf8')).toContain(
      `"version": ${DATA_LAYOUT_VERSION}`,
    )
    // The marker is the only thing a first start creates.
    expect(snapshot(dataRoot)).toEqual({
      'layout.json': expect.any(String),
    })
  })

  it('moves a legacy checkout’s images, logs and thumbnail cache by rename', () => {
    const { appRoot, dataRoot } = installation('data-layout-legacy-')
    write(path.join(appRoot, 'images', '1013_hash.jpg'), 'wallpaper')
    write(path.join(appRoot, 'logs', 'run-2026-10-18T01-03-31.jsonl'), '{"type":"run_meta"}\n')
    write(path.join(appRoot, 'web', '.console-cache', 'thumbnails', '1013_hash.jpg'), 'thumb')

    const result = ensureDataLayout({ appRoot, dataRoot })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.refusal.message)
    expect(result.ready.migrated.map(move => move.kind).toSorted()).toEqual([
      'cache',
      'images',
      'logs',
    ])
    // The data is intact, under the new root.
    expect(fs.readFileSync(path.join(dataRoot, 'images', '1013_hash.jpg'), 'utf8')).toBe(
      'wallpaper',
    )
    expect(
      fs.readFileSync(path.join(dataRoot, 'logs', 'run-2026-10-18T01-03-31.jsonl'), 'utf8'),
    ).toBe('{"type":"run_meta"}\n')
    expect(
      fs.readFileSync(path.join(dataRoot, 'cache', 'thumbnails', '1013_hash.jpg'), 'utf8'),
    ).toBe('thumb')
    // Nothing is left behind in the program directory.
    expect(fs.existsSync(path.join(appRoot, 'images'))).toBe(false)
    expect(fs.existsSync(path.join(appRoot, 'logs'))).toBe(false)
    expect(fs.existsSync(path.join(appRoot, 'web', '.console-cache'))).toBe(false)
    expect(fs.existsSync(path.join(dataRoot, 'layout.json'))).toBe(true)
  })

  it('recognises a checkout that configured its own Mirror and log names', () => {
    const { appRoot, dataRoot } = installation('data-layout-configured-legacy-')
    write(path.join(appRoot, 'mirror', '1013_hash.jpg'), 'wallpaper')
    write(path.join(appRoot, 'runs', 'run-2026-10-18T01-03-31.jsonl'), '{"type":"run_meta"}\n')

    const result = ensureDataLayout({
      appRoot,
      dataRoot,
      configuredImagesDir: 'mirror',
      configuredLogDir: 'runs',
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.refusal.message)
    expect(fs.readFileSync(path.join(dataRoot, 'mirror', '1013_hash.jpg'), 'utf8')).toBe(
      'wallpaper',
    )
    expect(
      fs.readFileSync(path.join(dataRoot, 'runs', 'run-2026-10-18T01-03-31.jsonl'), 'utf8'),
    ).toBe('{"type":"run_meta"}\n')
  })

  it('is idempotent: a second start moves nothing and keeps the marker', () => {
    const { appRoot, dataRoot } = installation('data-layout-idempotent-')
    write(path.join(appRoot, 'images', '1013_hash.jpg'), 'wallpaper')
    const first = ensureDataLayout({ appRoot, dataRoot })
    if (!first.ok) throw new Error(first.refusal.message)
    const marker = fs.readFileSync(path.join(dataRoot, 'layout.json'), 'utf8')
    const before = snapshot(dataRoot)

    const second = ensureDataLayout({ appRoot, dataRoot })

    expect(second).toMatchObject({ ok: true })
    if (!second.ok) throw new Error(second.refusal.message)
    expect(second.ready.migrated).toEqual([])
    expect(second.ready.markerWritten).toBe(false)
    expect(fs.readFileSync(path.join(dataRoot, 'layout.json'), 'utf8')).toBe(marker)
    expect(snapshot(dataRoot)).toEqual(before)
  })

  it('refuses a legacy directory whose new target already exists, leaving both untouched', () => {
    const { appRoot, dataRoot } = installation('data-layout-conflict-')
    write(path.join(appRoot, 'images', 'old.jpg'), 'old')
    write(path.join(dataRoot, 'images', 'new.jpg'), 'new')
    const beforeApp = snapshot(appRoot)
    const beforeData = snapshot(dataRoot)

    const result = ensureDataLayout({ appRoot, dataRoot })

    expect(result).toMatchObject({ ok: false })
    if (result.ok) throw new Error('the conflict must be refused')
    expect(result.refusal.code).toBe('legacy-conflict')
    expect(result.refusal.message).toContain('旧')
    expect(result.refusal.message).toContain('没有')
    expect(snapshot(appRoot)).toEqual(beforeApp)
    expect(snapshot(dataRoot)).toEqual(beforeData)
  })

  it('refuses a move across volumes instead of copying silently, leaving the data untouched', () => {
    const { appRoot, dataRoot } = installation('data-layout-cross-volume-')
    write(path.join(appRoot, 'images', '1013_hash.jpg'), 'wallpaper')
    const beforeApp = snapshot(appRoot)

    const result = ensureDataLayout({
      appRoot,
      dataRoot,
      sameVolume: () => false,
    })

    expect(result).toMatchObject({ ok: false })
    if (result.ok) throw new Error('a cross-volume move must be refused')
    expect(result.refusal.code).toBe('cross-volume')
    expect(result.refusal.message).toContain('磁盘')
    expect(snapshot(appRoot)).toEqual(beforeApp)
    expect(fs.existsSync(dataRoot)).toBe(false)
  })

  it('refuses a newer marker before touching anything', () => {
    const { appRoot, dataRoot } = installation('data-layout-newer-untouched-')
    write(path.join(dataRoot, 'layout.json'), `${JSON.stringify({ version: 99 })}\n`)
    write(path.join(dataRoot, 'images', '1013_hash.jpg'), 'wallpaper')
    write(path.join(appRoot, 'images', 'legacy.jpg'), 'legacy')
    const beforeData = snapshot(dataRoot)
    const beforeApp = snapshot(appRoot)

    const result = ensureDataLayout({ appRoot, dataRoot })

    expect(result).toMatchObject({ ok: false })
    if (result.ok) throw new Error('a newer layout must be refused')
    expect(result.refusal.code).toBe('newer-layout')
    expect(snapshot(dataRoot)).toEqual(beforeData)
    expect(snapshot(appRoot)).toEqual(beforeApp)
  })
})
