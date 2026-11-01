// ── Reading the archive the release check installs (#120) ───────────
//
// The release package is a zip (`scripts/zip.ts` writes it by hand, with
// `node:zlib`, because the repository has no archiver), and `scripts/package-check.ts`
// has to get the archive's real files onto a disk before it can install and boot
// them. Adding an unzipper dependency for one release-only command would put a
// second implementation of the format in the tree; reading the three record types
// the writer emits is smaller than that dependency:
//
//   end of central directory      where the index starts and how many entries;
//   central directory             one record per entry: name, method, sizes, crc,
//                                 and the offset of its local header;
//   local file header + payload   at that offset: the name again, then the bytes.
//
// The payload's compression is the format's two ordinary methods: `deflate`
// (method 8, `node:zlib`'s `inflateRawSync`) and `store` (method 0, the bytes
// as they are). Names are read as UTF-8 — the writer flags them so (bit 11) —
// because a reader that guessed a legacy code page would hand back mojibake for
// a Chinese-named entry.
//
// **The one safety rule.** Entry names go through `archivePathSegments` from
// `scripts/package-layout.ts`, the same rule the writer uses: forward slashes
// only, no leading slash, no drive letter, no empty/`.`/`..` segment. A name
// that fails it is refused here, before anything is written, and the extraction
// destination is re-checked for containment as defence in depth. An archive with
// `../evil.txt` is not a package this project produced, and it never gets to
// choose where a file lands.
//
// No zip64: the writer refuses to emit one (#86), and the release is far under
// the 4 GiB and 65,535-entry limits. A zip64 archive is refused by name rather
// than misread. Payloads are inflated in memory: a flat release unpacks to a few
// megabytes (the page bundle), so streaming would buy nothing and would make the
// error handling worse. Directory entries (a name ending in `/`) are not part of
// the writer's vocabulary either, so they are refused by the same path rule.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'

import { archivePathSegments } from './package-layout.js'

/** One file from the archive, in the order the central directory lists it. */
export interface ZipEntry {
  /** The archive-relative path, with forward slashes. */
  name: string
  /** The uncompressed bytes. */
  data: Buffer
}

/** What an extraction wrote, for the check's own report. */
export interface ExtractResult {
  /** Files written. */
  entries: number
  /** Their uncompressed bytes. */
  bytes: number
}

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const EOCD_SIZE = 22
const ZIP16_MAX = 0xffff
const ZIP32_MAX = 0xffffffff

const SIGNATURE_LOCAL = 0x04034b50
const SIGNATURE_CENTRAL = 0x02014b50
const SIGNATURE_EOCD = 0x06054b50

/** Compression method 8 = deflate; 0 = stored. */
const METHOD_DEFLATE = 8
const METHOD_STORE = 0

/** One central-directory record, read far enough to trust its payload's location. */
interface CentralEntry {
  name: string
  method: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

/** Not an archive this reader can read: the message says which record disagreed. */
function malformed(detail: string): Error {
  return new Error(`unzip: ${detail}`)
}

/**
 * Find the end-of-central-directory record, scanning back from the end.
 *
 * The payload can contain the signature bytes by accident, so the candidate is
 * accepted only when its comment length accounts for the rest of the file. The
 * scan is bounded the way the format is: a comment is at most 65,535 bytes.
 */
function eocdOffset(zip: Buffer): number {
  const last = zip.length - EOCD_SIZE
  if (last < 0) throw malformed('the file is too short to be a zip')
  for (let at = last; at >= 0 && at >= last - ZIP16_MAX; at -= 1) {
    if (zip.readUInt32LE(at) !== SIGNATURE_EOCD) continue
    if (at + EOCD_SIZE + zip.readUInt16LE(at + 20) === zip.length) return at
  }
  throw malformed('no end-of-central-directory record — not a zip')
}

/** Read the central directory, refusing the shapes this reader does not handle. */
function centralEntries(zip: Buffer, eocd: number): CentralEntry[] {
  const count = zip.readUInt16LE(eocd + 8)
  const centralSize = zip.readUInt32LE(eocd + 12)
  const centralOffset = zip.readUInt32LE(eocd + 16)

  if (count === ZIP16_MAX || centralSize === ZIP32_MAX || centralOffset === ZIP32_MAX) {
    throw malformed('the archive is zip64; this reader does not implement it (#120)')
  }
  if (centralOffset + centralSize > eocd) {
    throw malformed('the central directory runs past the end of the archive')
  }

  const entries: CentralEntry[] = []
  let cursor = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (cursor + CENTRAL_HEADER_SIZE > centralOffset + centralSize) {
      throw malformed(`the central directory ends before entry ${index + 1}`)
    }
    if (zip.readUInt32LE(cursor) !== SIGNATURE_CENTRAL) {
      throw malformed(`entry ${index + 1} has no central-directory record`)
    }

    const nameLength = zip.readUInt16LE(cursor + 28)
    const extraLength = zip.readUInt16LE(cursor + 30)
    const commentLength = zip.readUInt16LE(cursor + 32)
    const nameStart = cursor + CENTRAL_HEADER_SIZE
    const nameEnd = nameStart + nameLength
    if (nameEnd > zip.length) throw malformed(`entry ${index + 1} has a name past the end`)

    const name = zip.subarray(nameStart, nameEnd).toString('utf8')
    if (archivePathSegments(name) === null) {
      throw malformed(`refusing archive name "${name}": not a safe archive path`)
    }

    entries.push({
      name,
      method: zip.readUInt16LE(cursor + 10),
      crc: zip.readUInt32LE(cursor + 16),
      compressedSize: zip.readUInt32LE(cursor + 20),
      uncompressedSize: zip.readUInt32LE(cursor + 24),
      localOffset: zip.readUInt32LE(cursor + 42),
    })

    cursor = nameEnd + extraLength + commentLength
  }

  return entries
}

/**
 * The payload bytes of one entry, inflated or copied, checked against the
 * central directory's own crc and size.
 *
 * The local header is read for the payload's real start — it repeats the name
 * and may carry an extra field the central record does not — and the central
 * directory's sizes decide how much is payload, because that is the copy with
 * the checksum beside it.
 */
function payloadOf(zip: Buffer, entry: CentralEntry): Buffer {
  const local = entry.localOffset
  if (local + LOCAL_HEADER_SIZE > zip.length || zip.readUInt32LE(local) !== SIGNATURE_LOCAL) {
    throw malformed(`"${entry.name}" has no local file header at ${local}`)
  }

  const nameLength = zip.readUInt16LE(local + 26)
  const extraLength = zip.readUInt16LE(local + 28)
  const start = local + LOCAL_HEADER_SIZE + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > zip.length) throw malformed(`"${entry.name}" runs past the end of the archive`)

  const payload = zip.subarray(start, end)
  let data: Buffer
  if (entry.method === METHOD_DEFLATE) {
    try {
      data = inflateRawSync(payload)
    } catch (error) {
      throw malformed(
        `"${entry.name}" could not be inflated (${error instanceof Error ? error.message : String(error)})`,
      )
    }
  } else if (entry.method === METHOD_STORE) {
    data = Buffer.from(payload)
  } else {
    throw malformed(
      `"${entry.name}" uses compression method ${entry.method}, which is not deflate or store`,
    )
  }

  if (data.length !== entry.uncompressedSize) {
    throw malformed(
      `"${entry.name}" inflates to ${data.length} bytes, the archive says ${entry.uncompressedSize}`,
    )
  }
  if (crc32(data) !== entry.crc) {
    throw malformed(`"${entry.name}" does not match its checksum — the archive is corrupt`)
  }
  return data
}

/**
 * Read every file in the archive, in central-directory order, without writing
 * anything. Names are validated here, so a caller that only inspects an archive
 * gets the same refusal an extraction would give.
 */
export function readZip(file: string): ZipEntry[] {
  const zip = fs.readFileSync(file)
  const eocd = eocdOffset(zip)
  return centralEntries(zip, eocd).map(entry => ({
    name: entry.name,
    data: payloadOf(zip, entry),
  }))
}

/**
 * Extract every file under `destination`, creating the directories an entry's
 * path names. The destination is created if it does not exist; nothing else is.
 *
 * Containment is re-checked per entry even though `archivePathSegments` already
 * ruled out `..`: the rule and the join are two steps, and the second one must
 * not be the only thing standing between an archive name and a write outside the
 * destination. The resolved path is compared as a path, never as a string.
 */
export function extractZip(file: string, destination: string): ExtractResult {
  const destinationRoot = path.resolve(destination)
  const entries = readZip(file)

  let bytes = 0
  for (const entry of entries) {
    const segments = archivePathSegments(entry.name)
    if (segments === null) {
      // `readZip` already refused this; kept as a type-narrowing guard.
      throw malformed(`refusing archive name "${entry.name}": not a safe archive path`)
    }

    const target = path.resolve(destinationRoot, ...segments)
    const relative = path.relative(destinationRoot, target)
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw malformed(`refusing to write "${entry.name}" outside ${destinationRoot}`)
    }

    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, entry.data)
    bytes += entry.data.length
  }

  return { entries: entries.length, bytes }
}
