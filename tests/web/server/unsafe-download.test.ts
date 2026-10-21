// ── Files Windows marked as unsafe (#85) ────────────────────────────
//
// A zip that came from a browser carries Mark-of-the-Web, and extraction copies
// it to every file as a `:Zone.Identifier` stream. The symptom is not a clear
// error: the page opens blank, a thumbnail 500s, or the program will not start
// at all — a supporter's worst case, because every phrase the user can see is
// unrelated to the cause.
//
// So a start checks the files it is about to run and says, in Chinese, exactly
// which files are marked and what to do about it. The check is a pure predicate
// over an injected "is this file marked?" so the test never needs a real
// download; the real one reads the stream from the filesystem.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  hasZoneIdentifier,
  markedAsUnsafe,
  unsafeDownloadNotice,
} from '../../../web/server/unsafe-download.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('markedAsUnsafe', () => {
  it('names exactly the files that carry the mark', () => {
    const files = ['node.exe', 'server.js', 'run.js']

    expect(markedAsUnsafe(files, file => file === 'node.exe' || file === 'run.js')).toEqual([
      'node.exe',
      'run.js',
    ])
  })

  it('names nothing when no file is marked', () => {
    expect(markedAsUnsafe(['node.exe'], () => false)).toEqual([])
  })
})

describe('unsafeDownloadNotice', () => {
  it('says nothing when no file is marked', () => {
    expect(unsafeDownloadNotice([], 'C:\\install\\app')).toBeNull()
  })

  it('gives the unblock steps, in Chinese, for the marked files', () => {
    const notice = unsafeDownloadNotice(['C:\\install\\app\\node.exe'], 'C:\\install\\app')

    expect(notice).not.toBeNull()
    // The actionable part: what to click, and the one command that does it.
    expect(notice).toContain('解除锁定')
    expect(notice).toContain('Unblock-File')
    expect(notice).toContain('C:\\install\\app\\node.exe')
    expect(notice).toContain('C:\\install\\app')
  })
})

describe('hasZoneIdentifier', () => {
  it('reads the alternate data stream Windows writes on a downloaded file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-zone-'))
    roots.push(dir)
    const plain = path.join(dir, 'server.js')
    const marked = path.join(dir, 'node.exe')
    fs.writeFileSync(plain, 'program', 'utf8')
    fs.writeFileSync(marked, 'program', 'utf8')
    // What Explorer's extraction does to a downloaded file.
    fs.writeFileSync(`${marked}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n', 'utf8')

    expect(hasZoneIdentifier(marked)).toBe(true)
    expect(hasZoneIdentifier(plain)).toBe(false)
    expect(hasZoneIdentifier(path.join(dir, 'absent.exe'))).toBe(false)
  })
})
