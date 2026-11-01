// ── Reading the archive the packager wrote (#120) ───────────────────
//
// The release check installs and boots the real zip, and the repository has no
// unzipper — the packager writes its own format (`scripts/zip.ts`), so the check
// reads it back with `scripts/unzip.ts` and `node:zlib`. These tests are the
// round trip that makes that reader trustworthy: the writer produces an archive,
// the reader gives back exactly the names and bytes, and a name that could
// escape the extraction directory is refused.
//
// The writer's own tests read the finished bytes with a separate parser; this
// file is the reverse, and both exist because "the writer agrees with itself" is
// not an archive.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { extractZip, readZip } from '../../scripts/unzip.js'
import { writeZip } from '../../scripts/zip.js'

const roots: string[] = []

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

interface Fixture {
  archive: string
  names: string[]
  payloads: Buffer[]
}

/**
 * One archive the writer produced, with the shapes this reader has to handle:
 * a small stored entry, a repeated payload the writer deflates, a nested page
 * path, and a UTF-8 name (an unzipper that decoded GBK would hand back mojibake).
 */
function writeFixture(root: string): Fixture {
  const archive = path.join(root, 'package.zip')
  const names = [
    'README.md',
    'web/dist/index.html',
    'web/dist/assets/page.js',
    'web/dist/壁纸说明.txt',
    'web/dist/a.txt',
  ]
  const payloads = [
    Buffer.from('# re1999 wallpaper crawler\n', 'utf8'),
    Buffer.from('<html>壁纸</html>', 'utf8'),
    Buffer.alloc(20_000, 'a'),
    Buffer.from('这是一份页面里的中文说明。\n', 'utf8'),
    Buffer.from('a', 'utf8'),
  ]

  writeZip(
    archive,
    names.map((name, index) => ({ name, data: payloads[index] })),
  )
  return { archive, names, payloads }
}

describe('readZip', () => {
  it('reads every entry back by name and byte-for-byte, deflated and stored alike', () => {
    const fixture = writeFixture(tempRoot('unzip-read-'))
    const entries = readZip(fixture.archive)

    expect(entries.map(entry => entry.name)).toEqual(fixture.names)
    for (const [index, entry] of entries.entries()) {
      expect(entry.data.equals(fixture.payloads[index])).toBe(true)
    }
  })

  it('refuses an entry name that could escape the extraction directory', () => {
    // The writer refuses these names, so the archive is made by rewriting a
    // legal name in place — same byte length, so every offset in the finished
    // archive stays valid and only the name is hostile.
    for (const hostile of ['../../evil.txt', 'web\\dist\\a.txt']) {
      const fixture = writeFixture(tempRoot('unzip-read-'))
      replaceName(fixture.archive, 'web/dist/a.txt', hostile)
      expect(() => readZip(fixture.archive)).toThrow(/not a safe archive path/)
    }
  })
})

describe('extractZip', () => {
  it('writes the archive tree under one directory and reports what it wrote', () => {
    const root = tempRoot('unzip-extract-')
    const fixture = writeFixture(root)
    const destination = path.join(root, 'package')

    const result = extractZip(fixture.archive, destination)

    expect(result.entries).toBe(fixture.names.length)
    expect(result.bytes).toBe(fixture.payloads.reduce((total, data) => total + data.length, 0))
    for (const [index, name] of fixture.names.entries()) {
      const file = path.join(destination, ...name.split('/'))
      expect(fs.existsSync(file)).toBe(true)
      expect(fs.readFileSync(file).equals(fixture.payloads[index])).toBe(true)
    }
  })

  it('writes nothing outside the destination when a name escapes', () => {
    const root = tempRoot('unzip-extract-')
    const fixture = writeFixture(root)
    const destination = path.join(root, 'package')
    replaceName(fixture.archive, 'web/dist/a.txt', '../../evil.txt')

    expect(() => extractZip(fixture.archive, destination)).toThrow(/not a safe archive path/)
    expect(fs.existsSync(path.join(root, 'evil.txt'))).toBe(false)
    expect(fs.existsSync(path.join(destination, 'evil.txt'))).toBe(false)
  })
})

/**
 * Rewrite one entry's name in both places it is stored — the local header and
 * the central directory — keeping the archive's offsets intact. The replacement
 * must be the same byte length as the original.
 */
function replaceName(archive: string, from: string, to: string): void {
  const bytes = fs.readFileSync(archive)
  const fromBytes = Buffer.from(from, 'utf8')
  const toBytes = Buffer.from(to, 'utf8')
  expect(toBytes.length, 'the hostile name must not change the archive layout').toBe(
    fromBytes.length,
  )

  let occurrences = 0
  for (let at = bytes.indexOf(fromBytes); at !== -1; at = bytes.indexOf(fromBytes, at + 1)) {
    toBytes.copy(bytes, at)
    occurrences += 1
  }
  expect(occurrences, 'the local header and the central directory both name an entry').toBe(2)
  fs.writeFileSync(archive, bytes)
}
