// ── The Run log directory, as both entries read it (B5) ─────────────
//
// The pick and the probe are the two facts `check-run` and the Console's reader
// share; they are extracted into `src/run-log-file.ts` so the page and the
// command cannot drift. `check-run`'s own printed output was diffed byte for
// byte by hand when the extraction landed, so what these pin is the two
// shared decisions themselves: name order (never mtime), and a probe that
// counts a file only with a non-zero size.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createFileProbe, newestRunLogName, newestRunLogPath } from '../src/run-log-file.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function scratch(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

describe('newestRunLogName', () => {
  it('picks the last name in ascending order, never the most recently written file', () => {
    const dir = scratch('run-log-file-')
    const older = path.join(dir, 'save-wallpapers-2026-09-15T09-36-50.jsonl')
    const newest = path.join(dir, 'save-wallpapers-2026-10-18T01-03-31.jsonl')
    fs.writeFileSync(older, '{}\n')
    fs.writeFileSync(newest, '{}\n')
    // The older-named log written later must not win.
    const past = new Date(Date.now() - 3_600_000)
    fs.utimesSync(newest, past, past)

    expect(newestRunLogName(dir)).toBe('save-wallpapers-2026-10-18T01-03-31.jsonl')
    expect(newestRunLogPath(dir)).toBe(newest)
  })

  it('ignores files that are not Run logs, and a directory that is not there', () => {
    const dir = scratch('run-log-file-')
    fs.writeFileSync(path.join(dir, 'notes.jsonl'), '{}\n')
    fs.writeFileSync(path.join(dir, 'save-wallpapers-x.jsonl.bak'), '{}\n')

    expect(newestRunLogName(dir)).toBeNull()
    expect(newestRunLogPath(dir)).toBeNull()
    expect(newestRunLogName(path.join(dir, 'not-here'))).toBeNull()
    expect(newestRunLogPath(path.join(dir, 'not-here'))).toBeNull()
  })
})

describe('createFileProbe', () => {
  it('counts a file only when it is on disk with a non-zero size', () => {
    const dir = scratch('run-log-file-probe-')
    fs.writeFileSync(path.join(dir, '1013_hash.jpg'), 'a')
    fs.writeFileSync(path.join(dir, '1014_empty.png'), '')
    const probe = createFileProbe(dir)

    expect(probe('1013_hash.jpg')).toBe(true)
    // An empty file is the shape a failed download leaves: not "it arrived".
    expect(probe('1014_empty.png')).toBe(false)
    expect(probe('missing.png')).toBe(false)
    // A directory is deliberately not asserted: the shared probe is
    // `statSync(...).size > 0` (check-run's own expression, kept byte-identical
    // by the extraction), and an empty directory's size is 0 on NTFS but 4096
    // on ext4 — so this probe's answer there is platform-dependent, and pinning
    // either value would pin the filesystem rather than the code.
  })
})
