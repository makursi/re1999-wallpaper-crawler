// ── The Run log source's two lifetime inputs (#36) ──────────────────
//
// The pure table lives in run-state.ts and the HTTP behaviour is pinned in
// run-cleanup.test.ts. These pin the wiring between them: which log the
// Console's own dead child wrote, and what an acknowledgement does — and does
// not — hide.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { RunLogSourceOptions } from '../../../web/server/run-log-source.js'
import { createRunLogSource } from '../../../web/server/run-log-source.js'
import {
  fixtureProjectRoot,
  LOG_NAME,
  plainLine,
  runLog,
  runLogSourceOptionsIn,
} from './run-fixtures.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture(): RunLogSourceOptions {
  const root = fixtureProjectRoot('console-run-log-lifetime-')
  roots.push(root)
  return runLogSourceOptionsIn(root)
}

function writeLog(logDir: string, name: string, text: string): void {
  fs.writeFileSync(path.join(logDir, name), `${text}\n`, 'utf8')
}

describe('the Console\u2019s own Run', () => {
  it('reads its dead child\u2019s log orphaned, not as a terminal Run still writing', () => {
    const options = fixture()
    // The Console started the Run and watched it die: this is the log it wrote.
    const source = createRunLogSource({ ...options, ownRunLogName: () => LOG_NAME })
    expect(source.facts().state).toBe('idle')

    writeLog(options.logDir, LOG_NAME, runLog(plainLine('5. Downloading images...')))

    expect(source.facts().state).toBe('orphaned')
  })

  it('reads the same-shaped log running when the Console does not own it', () => {
    const options = fixture()
    const source = createRunLogSource(options)

    writeLog(options.logDir, LOG_NAME, runLog(plainLine('5. Downloading images...')))

    // A Run started from a terminal: recent write, no handle of ours.
    expect(source.facts().state).toBe('running')
  })
})

describe('an acknowledged Orphaned Run', () => {
  it('reads idle, and the log on disk is untouched', () => {
    const options = fixture()
    writeLog(options.logDir, LOG_NAME, runLog(plainLine('5. Downloading images...')))
    const before = fs.readFileSync(path.join(options.logDir, LOG_NAME))
    // Present at start-up: the leftover case.
    const source = createRunLogSource(options)
    expect(source.facts().state).toBe('orphaned')

    source.acknowledgeOrphan()

    expect(source.facts().state).toBe('idle')
    expect(fs.readFileSync(path.join(options.logDir, LOG_NAME)).equals(before)).toBe(true)
  })

  it('does not hide a newer Run that appeared afterwards', () => {
    const options = fixture()
    writeLog(options.logDir, LOG_NAME, runLog(plainLine('the leftover')))
    const source = createRunLogSource(options)
    source.acknowledgeOrphan()

    // A newer Run log supersedes the acknowledged claim, so the Console reads
    // the Run in flight instead of calling the directory idle.
    writeLog(
      options.logDir,
      'save-wallpapers-2026-10-19T00-00-00.jsonl',
      runLog(plainLine('a new run')),
    )

    expect(source.facts().state).toBe('running')
  })
})
