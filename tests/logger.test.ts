import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createLogger } from '../src/logger.js'

let logDir: string

beforeEach(() => {
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'))
})

afterEach(() => {
  fs.rmSync(logDir, { recursive: true, force: true })
})

// The Run log createLogger wrote into this test's directory. Reading it is the
// assertion: a Run log that is not on disk by now is the defect (docs/adr/0007).
function readRunLog(): string {
  const files = fs.readdirSync(logDir)
  if (files.length !== 1) throw new Error(`expected one Run log, found ${files.length}`)
  return fs.readFileSync(path.join(logDir, files[0]), 'utf8')
}

describe('createLogger', () => {
  it('puts a record on disk before the Run can carry on', () => {
    const logger = createLogger(logDir)
    logger.info('audit trail record')

    // No flush, no await: the record has to be written by the time the call
    // returns, so that a Run cannot keep working while its audit trail has
    // quietly stopped (docs/adr/0007).
    expect(readRunLog()).toContain('audit trail record')
  })

  it('keeps the Run log raw JSONL, not the pretty console rendering', () => {
    const logger = createLogger(logDir)
    logger.info({ phase: 'run-code' }, 'a record')

    // The report consumers grep "type":"run_report" in this file, so its
    // records must stay one JSON object per line (docs/adr/0002).
    const lines = readRunLog().trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({
      level: expect.any(Number),
      pid: expect.any(Number),
      hostname: expect.any(String),
      msg: 'a record',
      phase: 'run-code',
    })
  })

  it('sends the debug records to the Run log as well, not just info', () => {
    const logger = createLogger(logDir)
    logger.info('an info record')
    logger.debug('a debug record')

    const file = readRunLog()
    expect(file).toContain('an info record')
    expect(file).toContain('a debug record')
  })
})
