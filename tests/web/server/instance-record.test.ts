// ── The running Console's address (#82) ─────────────────────────────
//
// Double-clicking the launcher twice must not start two services writing the
// same Run log directory. So a start writes how to reach itself into the data
// directory — the port it actually bound and this boot's token — and every later
// start reads that record first and asks it whether it is still there.
//
// The record is a private handshake, not a saved credential: the token it
// carries is random per boot, so an old record's URL is worthless after a
// restart, and a record that cannot be read must never be a reason to fail —
// it is a reason to start normally.
//
// These are the record's pure parts. `instance-handshake.test.ts` drives the
// same module over a real socket against a real bound service.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  forgetInstanceRecord,
  INSTANCE_RECORD_FILE_NAME,
  instanceRecordPath,
  instanceUrlOf,
  readInstanceRecord,
  writeInstanceRecord,
} from '../../../web/server/instance-record.js'

const TOKEN = '0123456789abcdef0123456789abcdef'
const OTHER_TOKEN = 'fedcba9876543210fedcba9876543210'
const PID = 4242

const roots: string[] = []

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

function recordFileIn(dataRoot: string): string {
  fs.mkdirSync(dataRoot, { recursive: true })
  return instanceRecordPath(dataRoot)
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('instanceRecordPath', () => {
  it('names one JSON file directly under the data directory', () => {
    const dataRoot = path.join('C:\\', 'install', 'data')

    // The data directory, never the program directory: an update replaces
    // `app\` wholesale, and a handshake file is not the user's data either.
    expect(instanceRecordPath(dataRoot)).toBe(path.join(dataRoot, INSTANCE_RECORD_FILE_NAME))
    expect(INSTANCE_RECORD_FILE_NAME).toBe('instance.json')
  })
})

describe('writeInstanceRecord and readInstanceRecord', () => {
  it('round-trips the bound port, this boot token and pid', () => {
    const file = recordFileIn(tempRoot('console-instance-record-'))

    writeInstanceRecord(file, { port: 8791, token: TOKEN, pid: PID })

    expect(readInstanceRecord(file)).toMatchObject({
      kind: 'record',
      record: { version: 1, port: 8791, token: TOKEN, pid: PID },
    })
  })

  it('is absent, not invalid, when no start has written it', () => {
    const file = recordFileIn(tempRoot('console-instance-record-'))

    expect(readInstanceRecord(file)).toEqual({ kind: 'absent' })
  })

  it.each([
    ['not JSON at all', 'half a record'],
    ['a JSON array', '[]'],
    ['an object missing the token', '{"version":1,"port":8791,"pid":4242}'],
    ['a token that is not a string', '{"version":1,"port":8791,"token":7,"pid":4242}'],
    ['a port that is not an integer', '{"version":1,"port":"8791","token":"abc","pid":4242}'],
    ['a port outside 1..65535', '{"version":1,"port":70000,"token":"abc","pid":4242}'],
    ['a pid that is not a positive integer', '{"version":1,"port":8791,"token":"abc","pid":0}'],
    ['a version this program does not know', '{"version":2,"port":8791,"token":"abc","pid":1}'],
  ])('reads %s as invalid, never as a usable record', (_label, text) => {
    const file = recordFileIn(tempRoot('console-instance-record-'))
    fs.writeFileSync(file, text, 'utf8')

    const reading = readInstanceRecord(file)

    // "Invalid" is how every caller learns to start normally, so it must be a
    // real branch rather than an exception nobody catches.
    expect(reading.kind).toBe('invalid')
  })
})

describe('forgetInstanceRecord', () => {
  it('removes the record this boot wrote, so a shutdown leaves it unusable', () => {
    const file = recordFileIn(tempRoot('console-instance-record-'))
    writeInstanceRecord(file, { port: 8791, token: TOKEN, pid: PID })

    expect(forgetInstanceRecord(file, { token: TOKEN, pid: PID })).toBe(true)

    expect(readInstanceRecord(file)).toEqual({ kind: 'absent' })
  })

  it('leaves a record another boot wrote alone', () => {
    const file = recordFileIn(tempRoot('console-instance-record-'))
    writeInstanceRecord(file, { port: 8791, token: OTHER_TOKEN, pid: PID })

    // Two starts raced: the later one owns the record now, and the earlier one
    // shutting down must not pull the handshake out from under it.
    expect(forgetInstanceRecord(file, { token: TOKEN, pid: PID })).toBe(false)

    expect(readInstanceRecord(file)).toMatchObject({
      kind: 'record',
      record: { token: OTHER_TOKEN },
    })
  })
})

describe('instanceUrlOf', () => {
  it('names the running page exactly as the service reports it', () => {
    expect(instanceUrlOf({ version: 1, port: 8791, token: TOKEN, pid: PID })).toBe(
      `http://127.0.0.1:8791/?token=${TOKEN}`,
    )
  })
})
