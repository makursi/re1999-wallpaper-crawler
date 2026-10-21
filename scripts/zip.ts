// ── The zip a release is (#86) ──────────────────────────────────────
//
// The package has no archiver in its dependency tree — a release is one file a
// person unzips on a machine that has nothing but Windows — so the packager
// writes the archive itself, with `node:zlib` and the format's three record
// types:
//
//   local file header + payload   one per file, at the offset the central
//                                 directory records;
//   central directory             the index an unzipper reads first;
//   end of central directory      where the index starts and how many entries.
//
// Two details are load-bearing on this platform:
//
//   - **Names are UTF-8, flagged as such** (general-purpose bit 11). The archive
//     root's launcher is `启动.bat`; a reader that guesses GBK would show the
//     owner a different file name than the one they downloaded.
//   - **No zip64.** A package is ~150 MB unpacked with one entry of ~92 MB, far
//     under the 4 GiB and 65,535-entry limits. The writer checks those limits and
//     fails with a clear message rather than emitting a corrupt archive, because
//     a silent zip64 gap is a file that only some unzippers open.
//
// Entry names go through `archivePathSegments` from the whitelist module: a name
// with `..`, a backslash or a drive letter is refused here too, so the writer
// cannot be talked into an extraction escape even by a caller that skipped the
// whitelist assertion.

import * as fs from 'node:fs'
import { crc32, deflateRawSync } from 'node:zlib'

import { archivePathSegments } from './package-layout.js'

/** One file to put in the archive: bytes in memory, or a file to read now. */
export type ZipEntrySource = { name: string; data: Uint8Array } | { name: string; file: string }

/** What the writer did, for the packager's report. */
export interface ZipWriteResult {
  /** Entries written. */
  entries: number
  /** The archive's size on disk. */
  zipBytes: number
  /** The sum of the entries' uncompressed sizes. */
  sourceBytes: number
}

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const EOCD_SIZE = 22
const ZIP32_MAX = 0xffffffff
const ZIP16_MAX = 0xffff

const SIGNATURE_LOCAL = 0x04034b50
const SIGNATURE_CENTRAL = 0x02014b50
const SIGNATURE_EOCD = 0x06054b50

/** General-purpose bit 11: the entry's name is UTF-8. */
const FLAG_UTF8 = 0x0800

/** Compression method 8 = deflate; 0 = stored. */
const METHOD_DEFLATE = 8
const METHOD_STORE = 0

/** The DOS timestamp an entry carries, from a JavaScript date. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107)
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const seconds = Math.floor(date.getSeconds() / 2)
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  }
}

/**
 * Write one zip containing exactly these entries.
 *
 * The output file is truncated and written in one pass: a local header and
 * payload per entry, then the central directory, then the EOCD. Writes are
 * synchronous on purpose — the packager is a one-shot command, and a partial
 * archive caused by async interleaving is worse than a slower build.
 */
export function writeZip(outputFile: string, entries: readonly ZipEntrySource[]): ZipWriteResult {
  if (entries.length > ZIP16_MAX) {
    throw new Error(
      `package: ${entries.length} files is beyond this packager's zip (${ZIP16_MAX}); zip64 is not implemented (#86)`,
    )
  }

  const names = new Set<string>()
  const central: Buffer[] = []
  let offset = 0
  let sourceBytes = 0
  let zipBytes = 0

  const fd = fs.openSync(outputFile, 'w')
  try {
    for (const entry of entries) {
      const segments = archivePathSegments(entry.name)
      if (segments === null) {
        throw new Error(`package: refusing archive name "${entry.name}": not a safe archive path`)
      }
      if (names.has(entry.name)) {
        throw new Error(`package: refusing the archive: "${entry.name}" is in it twice`)
      }
      names.add(entry.name)

      const data = 'data' in entry ? Buffer.from(entry.data) : fs.readFileSync(entry.file)
      const modified = 'file' in entry ? fs.statSync(entry.file).mtime : new Date()
      const nameBytes = Buffer.from(entry.name, 'utf8')

      const deflated = deflateRawSync(data)
      const compressed = deflated.length < data.length
      const method = compressed ? METHOD_DEFLATE : METHOD_STORE
      const payload = compressed ? deflated : data
      const checksum = crc32(data)

      if (data.length > ZIP32_MAX || payload.length > ZIP32_MAX || offset > ZIP32_MAX) {
        throw new Error(
          'package: the archive outgrew zip32 (4 GiB); zip64 is not implemented (#86)',
        )
      }

      const { time, date } = dosDateTime(modified)
      const local = Buffer.alloc(LOCAL_HEADER_SIZE)
      local.writeUInt32LE(SIGNATURE_LOCAL, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(FLAG_UTF8, 6)
      local.writeUInt16LE(method, 8)
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt32LE(checksum, 14)
      local.writeUInt32LE(payload.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(nameBytes.length, 26)
      local.writeUInt16LE(0, 28)
      fs.writeSync(fd, local)
      fs.writeSync(fd, nameBytes)
      fs.writeSync(fd, payload)

      const centralHeader = Buffer.alloc(CENTRAL_HEADER_SIZE)
      centralHeader.writeUInt32LE(SIGNATURE_CENTRAL, 0)
      centralHeader.writeUInt16LE(20, 4) // version made by
      centralHeader.writeUInt16LE(20, 6) // version needed to extract
      centralHeader.writeUInt16LE(FLAG_UTF8, 8)
      centralHeader.writeUInt16LE(method, 10)
      centralHeader.writeUInt16LE(time, 12)
      centralHeader.writeUInt16LE(date, 14)
      centralHeader.writeUInt32LE(checksum, 16)
      centralHeader.writeUInt32LE(payload.length, 20)
      centralHeader.writeUInt32LE(data.length, 24)
      centralHeader.writeUInt16LE(nameBytes.length, 28)
      centralHeader.writeUInt16LE(0, 30) // extra length
      centralHeader.writeUInt16LE(0, 32) // comment length
      centralHeader.writeUInt16LE(0, 34) // disk number start
      centralHeader.writeUInt16LE(0, 36) // internal attributes
      centralHeader.writeUInt32LE(0, 38) // external attributes
      centralHeader.writeUInt32LE(offset, 42)
      central.push(centralHeader, nameBytes)

      offset += LOCAL_HEADER_SIZE + nameBytes.length + payload.length
      sourceBytes += data.length
      zipBytes += LOCAL_HEADER_SIZE + nameBytes.length + payload.length
    }

    const centralOffset = offset
    for (const chunk of central) {
      fs.writeSync(fd, chunk)
      offset += chunk.length
    }
    const centralSize = offset - centralOffset

    const eocd = Buffer.alloc(EOCD_SIZE)
    eocd.writeUInt32LE(SIGNATURE_EOCD, 0)
    eocd.writeUInt16LE(0, 4) // this disk
    eocd.writeUInt16LE(0, 6) // disk with the central directory
    eocd.writeUInt16LE(entries.length, 8)
    eocd.writeUInt16LE(entries.length, 10)
    eocd.writeUInt32LE(centralSize, 12)
    eocd.writeUInt32LE(centralOffset, 16)
    eocd.writeUInt16LE(0, 20) // comment length
    fs.writeSync(fd, eocd)
    zipBytes = offset + EOCD_SIZE
  } finally {
    fs.closeSync(fd)
  }

  return { entries: entries.length, zipBytes, sourceBytes }
}
