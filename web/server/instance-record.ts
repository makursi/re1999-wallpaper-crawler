// ── The running Console's address (#82) ─────────────────────────────
//
// One program, one service. A second double-click must not start a second
// service over the same Run log directory: instead the start records how to
// reach itself — the port it actually bound and the token this boot generated —
// in the data directory, and every later start reads that record and asks it
// whether the service is still there.
//
// The record is a private handshake, not a saved credential. Its token is
// random per boot (`web/server/console.ts` generates it), so the URL it names is
// worthless after a restart: the next boot's service holds a different token and
// refuses the old one in the guard. That is the property this file must not
// weaken, which is why nothing here takes a token from disk and reuses it.
//
// Every failure to read the record is a reason to start normally, never a reason
// to fail: an absent file is a first start, a half-written one is a crash, an
// unreadable one is someone else's business. The record lives under the data
// directory — never under the program directory, which an update replaces — and
// it is removed when the boot that wrote it shuts down cleanly.
//
// The network half (asking the recorded address whether it answers, and what
// makes it the *same* service rather than a stranger on the port) lives in
// `instance-handshake.ts`; this module is the record itself.

import * as fs from 'node:fs'
import * as path from 'node:path'

/** The record's file name, directly under the data directory. */
export const INSTANCE_RECORD_FILE_NAME = 'instance.json'

/**
 * The record's shape version. A version this program does not know is not read
 * as a handshake: starting a second service is the safe answer, and a shape that
 * changes later must not be guessed at.
 */
export const INSTANCE_RECORD_VERSION = 1

/** How this boot can be reached: what the next start reads before starting. */
export interface InstanceRecord {
  version: number
  /** The port the service actually bound, never the preferred one. */
  port: number
  /** This boot's access token — random per boot, and never a saved credential. */
  token: string
  /** The process that wrote the record; a shutdown only removes its own. */
  pid: number
}

/** What this boot knows about itself when it publishes the record. */
export type InstanceIdentity = Omit<InstanceRecord, 'version'>

/**
 * What proves a record is this boot's: the token it generated and its pid. The
 * port is not ownership — it is where the record points, and two boots never
 * share it while both run.
 */
export type InstanceOwnership = Pick<InstanceIdentity, 'token' | 'pid'>

export type InstanceRecordReading =
  | { kind: 'absent' }
  | { kind: 'invalid'; detail: string }
  | { kind: 'record'; record: InstanceRecord }

/** `<data>/instance.json` — the handshake's one address. */
export function instanceRecordPath(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), INSTANCE_RECORD_FILE_NAME)
}

/**
 * The page's URL for a record, in the exact form the service prints and opens:
 * the same origin the guard compares `Host` against and the token as a query
 * parameter the page reads (`web/src/console-token.ts`).
 */
export function instanceUrlOf(record: InstanceRecord): string {
  return `http://127.0.0.1:${record.port}/?token=${encodeURIComponent(record.token)}`
}

/**
 * Read the record without assuming its shape.
 *
 * `absent` is a first start; `invalid` is a record this program must not trust
 * (a crash mid-write, a newer shape, a hand-edited file). Both lead the caller
 * to the same place — start normally — but they are different facts, and the
 * detail is what a support session would read.
 */
export function readInstanceRecord(file: string): InstanceRecordReading {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    return hasErrorCode(error, 'ENOENT')
      ? { kind: 'absent' }
      : { kind: 'invalid', detail: 'the file could not be read' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'invalid', detail: 'not JSON' }
  }
  return recordOf(parsed)
}

function recordOf(parsed: unknown): InstanceRecordReading {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'invalid', detail: 'not an object' }
  }
  if (!('version' in parsed) || !('port' in parsed) || !('token' in parsed) || !('pid' in parsed)) {
    return { kind: 'invalid', detail: 'a field is missing' }
  }

  const { version, port, token, pid } = parsed
  if (version !== INSTANCE_RECORD_VERSION) {
    return { kind: 'invalid', detail: `shape version ${String(version)} is not known` }
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { kind: 'invalid', detail: 'the port is not 1..65535' }
  }
  if (typeof token !== 'string' || token.length === 0) {
    return { kind: 'invalid', detail: 'the token is not a non-empty string' }
  }
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 1) {
    return { kind: 'invalid', detail: 'the pid is not a positive integer' }
  }
  return { kind: 'record', record: { version, port, token, pid } }
}

/**
 * Publish this boot's address.
 *
 * The parent is created because a first start publishes before anything else
 * has had a reason to write into the data directory. The write is a plain
 * overwrite: a reader that catches the file mid-write gets `invalid` and starts
 * normally, which is the same answer as an absent record — and the record is
 * only ever written by a boot that has already bound its port.
 */
export function writeInstanceRecord(file: string, identity: InstanceIdentity): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const record: InstanceRecord = { version: INSTANCE_RECORD_VERSION, ...identity }
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

/**
 * Remove the record when this boot is the one that owns it, and say whether it
 * did.
 *
 * Two starts can race before either has written a record; the later writer owns
 * the file. An earlier one closing afterwards must not delete the handshake out
 * from under the service that is still running — ownership is the token this
 * boot generated, which no other boot shares.
 */
export function forgetInstanceRecord(file: string, owner: InstanceOwnership): boolean {
  const reading = readInstanceRecord(file)
  if (reading.kind !== 'record') return false
  if (reading.record.token !== owner.token || reading.record.pid !== owner.pid) return false
  fs.rmSync(file, { force: true })
  return true
}

/** Whether an unknown thrown value is a Node error with this `code`. */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
