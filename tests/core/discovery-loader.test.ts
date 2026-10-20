// ── The Discovery script copy, materialized once (#51) ──────────────
//
// `run-code --filename` can only be handed a real file, so a Run materializes
// one. What these pin is the decision the spec bought: the copy is written only
// when its content differs, it is never deleted, and both its directory and its
// payload are injected so a test never touches the repository's own cache.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { DiscoveryScriptCopy } from '../../core/discovery/discovery-loader.js'
import { materializeDiscoveryScript } from '../../core/discovery/discovery-loader.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function scratch(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

// The payload's real shape: a bare arrow expression whose one placeholder is
// substituted before it reaches `run-code`.
const PAYLOAD = '\nasync (page) => {\n  return "__PAGE_HASH__"\n}\n'
const SUBSTITUTED = '\nasync (page) => {\n  return "#wallpaper"\n}\n'
const HASH = '#wallpaper'

function payloadFile(root: string, text = PAYLOAD): string {
  const file = path.join(root, 'run-discovery.js')
  fs.writeFileSync(file, text, 'utf8')
  return file
}

function fixture(target = 'cache'): { source: string; target: string } {
  const root = scratch('discovery-copy-')
  return { source: payloadFile(root), target: path.join(root, target) }
}

function copyInto(target: string, source: string): DiscoveryScriptCopy {
  return materializeDiscoveryScript({ dir: target, source, hash: HASH })
}

describe('materializeDiscoveryScript', () => {
  it('writes the payload into the target directory and reports the write', () => {
    const { source, target } = fixture()

    const copy = copyInto(target, source)

    expect(copy.written).toBe(true)
    expect(path.isAbsolute(copy.path)).toBe(true)
    expect(path.basename(copy.path)).toBe('run-discovery.generated.js')
    expect(path.dirname(copy.path)).toBe(target)
    expect(fs.readFileSync(copy.path, 'utf8')).toBe(SUBSTITUTED)
  })

  // The reason the copy exists at all: a Run that changes nothing must not write.
  // The modification time is moved into the past first, so "unchanged" is proved
  // by a stamp a write could not have left behind, not by bytes alone.
  it('reuses the copy when the payload is unchanged, without touching the file', () => {
    const { source, target } = fixture()
    const stamp = new Date('2020-01-01T00:00:00.000Z')

    const first = copyInto(target, source)
    fs.utimesSync(first.path, stamp, stamp)
    const second = copyInto(target, source)

    expect(second.written).toBe(false)
    expect(second.path).toBe(first.path)
    expect(second.sha256).toBe(first.sha256)
    expect(fs.statSync(second.path).mtimeMs).toBe(stamp.getTime())
    expect(fs.readFileSync(second.path, 'utf8')).toBe(SUBSTITUTED)
  })

  it('rewrites the copy when the page hash changes', () => {
    const { source, target } = fixture()

    const original = copyInto(target, source)
    const changed = materializeDiscoveryScript({ dir: target, source, hash: '#gallery' })

    expect(changed.written).toBe(true)
    expect(fs.readFileSync(changed.path, 'utf8')).toContain('#gallery')
    expect(changed.sha256).not.toBe(original.sha256)
  })

  it('rewrites the copy when the payload changes', () => {
    const { source, target } = fixture()

    copyInto(target, source)
    fs.writeFileSync(
      source,
      PAYLOAD.replace('return', 'await page.evaluate(() => {})\n  return'),
      'utf8',
    )
    const copy = copyInto(target, source)

    expect(copy.written).toBe(true)
    expect(fs.readFileSync(copy.path, 'utf8')).toContain('page.evaluate')
  })

  // Content is compared rather than trusted, so an external hand that reformats
  // or truncates the copy (a formatter, a stray edit) cannot survive a Run.
  it('repairs a copy that something else corrupted', () => {
    const { source, target } = fixture()

    const first = copyInto(target, source)
    fs.writeFileSync(first.path, ';async (page) => {}', 'utf8')
    const repaired = copyInto(target, source)

    expect(repaired.written).toBe(true)
    expect(fs.readFileSync(repaired.path, 'utf8')).toBe(SUBSTITUTED)
  })

  it('creates the target directory when it does not exist yet', () => {
    const { source, target } = fixture(path.join('not', 'there', 'yet'))

    const copy = copyInto(target, source)

    expect(fs.existsSync(copy.path)).toBe(true)
  })

  // A literal, worked out outside the test: the hash is what a Run log quotes to
  // say which payload ran, so it has to be the hash of these exact bytes.
  it('reports the hash of the content it materialized', () => {
    const { source, target } = fixture()

    const copy = copyInto(target, source)

    expect(copy.sha256).toBe('9148ba7003b0ef181fa5a055a0d1caeb4c7a4be7f99533feef967b748c8792e2')
  })
})
