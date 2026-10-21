// ── The zip the package is (#86) ────────────────────────────────────
//
// A release is one zip that a person unzips anywhere and double-clicks. There is
// no archiver in the dependency tree, so the packager writes the archive itself
// with `node:zlib` — and that means the format is this repository's
// responsibility now.
//
// These tests do not trust the writer's own bookkeeping: they read the finished
// bytes back with a small independent parser (central directory → local header →
// inflate) and compare the payloads and names. A Chinese name and the UTF-8 flag
// are pinned because the archive root's launcher is Chinese-named: an unzipper
// that reads GBK instead would hand the user mojibake.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vitest'

import type { ZipEntrySource } from '../../scripts/zip.js'
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

interface ReadEntry {
  name: string
  method: number
  flags: number
  crc: number
  data: Buffer
}

/**
 * A deliberately separate reader: it walks the central directory, trusts the
 * local header for the payload's position, and inflates with `node:zlib`. If the
 * writer's offsets or sizes were wrong this is where it shows.
 */
function readZip(file: string): ReadEntry[] {
  const zip = fs.readFileSync(file)
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(eocd, 'end of central directory').toBeGreaterThanOrEqual(0)

  const count = zip.readUInt16LE(eocd + 10)
  let cursor = zip.readUInt32LE(eocd + 16)
  const entries: ReadEntry[] = []

  for (let index = 0; index < count; index += 1) {
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50)
    const flags = zip.readUInt16LE(cursor + 8)
    const method = zip.readUInt16LE(cursor + 10)
    const expectedCrc = zip.readUInt32LE(cursor + 16)
    const compressedSize = zip.readUInt32LE(cursor + 20)
    const nameLength = zip.readUInt16LE(cursor + 28)
    const extraLength = zip.readUInt16LE(cursor + 30)
    const commentLength = zip.readUInt16LE(cursor + 32)
    const localOffset = zip.readUInt32LE(cursor + 42)
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')

    expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50)
    const localNameLength = zip.readUInt16LE(localOffset + 26)
    const localExtraLength = zip.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const payload = zip.subarray(start, start + compressedSize)
    const data = method === 8 ? inflateRawSync(payload) : Buffer.from(payload)

    entries.push({ name, method, flags, crc: expectedCrc, data })
    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

function entry(name: string, data: Buffer): ZipEntrySource {
  return { name, data }
}

describe('writeZip', () => {
  it('writes named entries whose payloads come back byte-for-byte, Chinese names included', () => {
    const output = path.join(tempRoot('package-zip-'), 'archive.zip')
    const launcher = Buffer.from('@echo off\r\ncd /d "%~dp0app"\r\n', 'utf8')
    const page = Buffer.from('<html>壁纸</html>', 'utf8')
    const repetitive = Buffer.alloc(20_000, 'a')

    const result = writeZip(output, [
      entry('启动.bat', launcher),
      entry('app/web/dist/index.html', page),
      entry('app/web/dist/assets/page.js', repetitive),
    ])

    const entries = readZip(output)
    expect(entries.map(item => item.name)).toEqual([
      '启动.bat',
      'app/web/dist/index.html',
      'app/web/dist/assets/page.js',
    ])
    expect(entries[0]?.data.equals(launcher)).toBe(true)
    expect(entries[1]?.data.equals(page)).toBe(true)
    expect(entries[2]?.data.equals(repetitive)).toBe(true)

    // Every name is UTF-8, or the root launcher's own name is mojibake.
    for (const item of entries) expect(item.flags & 0x0800).toBe(0x0800)
    // A repeated payload is worth deflating; the archive does not grow.
    expect(entries[2]?.method).toBe(8)
    expect(result.zipBytes).toBe(fs.statSync(output).size)
    expect(result.sourceBytes).toBe(launcher.length + page.length + repetitive.length)
    expect(result.entries).toBe(3)
  })

  it('reads a file from disk and checks its CRC', () => {
    const root = tempRoot('package-zip-')
    const source = path.join(root, 'server.js')
    const bytes = Buffer.from('console.log("壁纸")\n', 'utf8')
    fs.writeFileSync(source, bytes)

    writeZip(path.join(root, 'archive.zip'), [{ name: 'app/server.js', file: source }])

    const [entryRead] = readZip(path.join(root, 'archive.zip'))
    expect(entryRead?.data.equals(bytes)).toBe(true)
    expect(entryRead?.crc).toBe(crc32(bytes))
  })

  it('refuses a name that could escape the extraction directory or is not an archive path', () => {
    const output = path.join(tempRoot('package-zip-'), 'archive.zip')
    for (const name of ['../evil.bat', 'app\\server.js', '/app/server.js', 'app//server.js']) {
      expect(() => writeZip(output, [entry(name, Buffer.from('x'))])).toThrow(
        /not a safe archive path/,
      )
    }
  })

  it('refuses two entries with the same name', () => {
    const output = path.join(tempRoot('package-zip-'), 'archive.zip')

    expect(() =>
      writeZip(output, [
        entry('app/server.js', Buffer.from('a')),
        entry('app/server.js', Buffer.from('b')),
      ]),
    ).toThrow(/app\/server\.js/)
  })
})
