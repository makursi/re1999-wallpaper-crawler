// ── The Run log directory, as both entries read it (B5) ─────────────
//
// The pick and the probe are the two facts `check-run` and the Console's reader
// share; they are extracted into `core/run-log-file.ts` so the page and the
// command cannot drift. `check-run`'s own printed output was diffed byte for
// byte by hand when the extraction landed, so what these pin is the two
// shared decisions themselves: ordering by the name's runId across both
// prefixes (never by mtime, never by the whole name), and a probe that counts a
// file only with a non-zero size.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createFileProbe, newestRunLogName, newestRunLogPath } from '../../core/run-log-file.js'

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
  it('picks the newest runId, never the most recently written file', () => {
    const dir = scratch('run-log-file-')
    const older = path.join(dir, 'run-2026-09-15T09-36-50.jsonl')
    const newest = path.join(dir, 'run-2026-10-18T01-03-31.jsonl')
    fs.writeFileSync(older, '{}\n')
    fs.writeFileSync(newest, '{}\n')
    // The older-named log written later must not win.
    const past = new Date(Date.now() - 3_600_000)
    fs.utimesSync(newest, past, past)

    expect(newestRunLogName(dir)).toBe('run-2026-10-18T01-03-31.jsonl')
    expect(newestRunLogPath(dir)).toBe(newest)
  })

  it('orders mixed prefixes by runId, not by the whole file name', () => {
    const dir = scratch('run-log-file-')
    // The trap this pick exists for: a plain string sort ranks every legacy
    // `save-wallpapers-…` after every new `run-…` (`s` > `r`), so the older
    // legacy Run would beat today's new one. Both false signals are present:
    // the prefix and the mtime favour the legacy log.
    const legacyOlder = path.join(dir, 'save-wallpapers-2026-09-15T09-36-50.jsonl')
    const newNewest = path.join(dir, 'run-2026-10-18T01-03-31.jsonl')
    fs.writeFileSync(legacyOlder, '{}\n')
    fs.writeFileSync(newNewest, '{}\n')
    const past = new Date(Date.now() - 3_600_000)
    fs.utimesSync(newNewest, past, past)

    expect(newestRunLogName(dir)).toBe('run-2026-10-18T01-03-31.jsonl')
    expect(newestRunLogPath(dir)).toBe(newNewest)
  })

  it('still reads a directory that holds only legacy-named logs', () => {
    const dir = scratch('run-log-file-')
    fs.writeFileSync(path.join(dir, 'save-wallpapers-2026-09-15T09-36-50.jsonl'), '{}\n')
    fs.writeFileSync(path.join(dir, 'save-wallpapers-2026-10-18T01-03-31.jsonl'), '{}\n')

    expect(newestRunLogName(dir)).toBe('save-wallpapers-2026-10-18T01-03-31.jsonl')
    expect(newestRunLogPath(dir)).toBe(path.join(dir, 'save-wallpapers-2026-10-18T01-03-31.jsonl'))
  })

  it('ignores files that are not Run logs, and a directory that is not there', () => {
    const dir = scratch('run-log-file-')
    fs.writeFileSync(path.join(dir, 'notes.jsonl'), '{}\n')
    fs.writeFileSync(path.join(dir, 'run-2026-10-18T01-03-31.jsonl.bak'), '{}\n')
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
