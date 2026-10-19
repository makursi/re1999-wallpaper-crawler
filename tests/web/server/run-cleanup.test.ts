// ── Cleaning an Orphaned Run from the page (#36) ────────────────────
//
// The seam is the Console's HTTP API, as the spec asks: an unfinished Run log
// present at start-up is reported orphaned, blocks the next start, can be
// cleaned, and afterwards the state is idle and a Run starts. The fixture Run
// log is compared byte for byte afterwards — the cleanup acknowledges a claim,
// it never edits the audit trail.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ConsoleConfig } from '../../../web/server/console-config.js'
import type { RunLauncher } from '../../../web/server/run-control.js'
import {
  createRunCleaner,
  createRunStarter,
  ORPHANED_RUN_REASON,
} from '../../../web/server/run-control.js'
import type { RunLogSource } from '../../../web/server/run-log-source.js'
import { createRunLogSource } from '../../../web/server/run-log-source.js'
import type { ConsoleService } from '../../../web/server/server.js'
import { startConsoleServer } from '../../../web/server/server.js'
import {
  consoleConfigIn,
  fixtureProjectRoot,
  LOG_NAME,
  plainLine,
  runLog,
  RUN_ID,
  TOKEN,
} from './run-fixtures.js'

const roots: string[] = []
const services: ConsoleService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.close()))
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

interface Harness {
  service: ConsoleService
  config: ConsoleConfig
  source: RunLogSource
  /** How many starts were accepted; a refusal must leave this at 0. */
  starts: () => number
  /** How many times the cleanup asked the browser CLI to close the session. */
  sessionCloses: () => number
}

function writeLog(config: ConsoleConfig, text: string): void {
  fs.writeFileSync(path.join(config.logDir, LOG_NAME), `${text}\n`, 'utf8')
}

function logPath(config: ConsoleConfig): string {
  return path.join(config.logDir, LOG_NAME)
}

/**
 * The real service over a fixture repository, with the launcher, the browser
 * CLI and the prerequisite check injected so nothing is spawned.
 *
 * `seed` runs before the log source exists, so what it writes is in the
 * Console's start-up listing — which is exactly what makes it a leftover rather
 * than a Run that appeared while the Console was open (§6a's `seenAtStartup`).
 */
async function serve(seed: (config: ConsoleConfig) => void = () => {}): Promise<Harness> {
  const projectRoot = fixtureProjectRoot('console-cleanup-')
  roots.push(projectRoot)
  const config = consoleConfigIn(projectRoot)
  seed(config)

  let alive = false
  let starts = 0
  const launcher: RunLauncher = {
    start: () => {
      starts++
      alive = true
    },
    isAlive: () => alive,
    stop: () => {
      alive = false
    },
  }

  const source = createRunLogSource({
    logDir: config.logDir,
    galleryStateFile: config.galleryStateFile,
    imagesDir: config.imagesDir,
    liveChild: () => launcher.isAlive(),
  })
  const startRun = createRunStarter({
    launcher,
    // A Run in flight or a leftover that may still be writing: both hold the
    // one persistent Browser session, so neither lets a new Run start.
    isRunInFlight: () => source.facts().state !== 'idle',
    missingPrerequisites: () => [],
    busyReason: () => (source.facts().state === 'orphaned' ? ORPHANED_RUN_REASON : null),
  })

  let sessionCloses = 0
  const cleanupRun = createRunCleaner({
    isRunInFlight: () => source.facts().state === 'running',
    closeBrowserSession: () => {
      sessionCloses++
    },
    acknowledgeOrphan: () => source.acknowledgeOrphan(),
  })

  const service = await startConsoleServer(config, {
    runState: () => source.facts(),
    galleryFacts: () => ({ officialTotal: 1010, listAvailable: true }),
    startRun,
    cleanupRun,
    token: TOKEN,
    port: 0,
  })
  services.push(service)

  return {
    service,
    config,
    source,
    starts: () => starts,
    sessionCloses: () => sessionCloses,
  }
}

async function getStatus(harness: Harness): Promise<unknown> {
  const response = await fetch(`${harness.service.origin}/api/status?token=${TOKEN}`)
  expect(response.status).toBe(200)
  return response.json()
}

function postStart(harness: Harness): Promise<Response> {
  return fetch(`${harness.service.origin}/api/run?token=${TOKEN}`, { method: 'POST' })
}

function postCleanup(harness: Harness): Promise<Response> {
  return fetch(`${harness.service.origin}/api/run/cleanup?token=${TOKEN}`, { method: 'POST' })
}

describe('an Orphaned Run over HTTP', () => {
  /** The leftover: a log present at start-up, unfinished and just written. */
  function withLeftover(): Promise<Harness> {
    return serve(config => writeLog(config, runLog(plainLine('5. Downloading images...'))))
  }

  it('is reported orphaned, with the Run id and the log name the page shows', async () => {
    const harness = await withLeftover()

    expect(await getStatus(harness)).toMatchObject({
      state: 'orphaned',
      runId: RUN_ID,
      runLogName: LOG_NAME,
    })
  })

  it('refuses a start, naming the cleanup rather than a Run in flight', async () => {
    const harness = await withLeftover()

    const response = await postStart(harness)

    expect(response.status).toBe(409)
    const body: unknown = await response.json()
    expect(body).toMatchObject({ started: false })
    expect(body).toMatchObject({ reason: expect.stringMatching(/Orphaned Run/) })
    expect(body).toMatchObject({ reason: expect.stringMatching(/clean/i) })
    expect(harness.starts()).toBe(0)
  })

  it('can be cleaned, after which the state is idle and a Run starts', async () => {
    const harness = await withLeftover()
    const before = fs.readFileSync(logPath(harness.config))

    const response = await postCleanup(harness)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ cleaned: true, reason: null })
    // The leftover Browser session is closed through the CLI, once.
    expect(harness.sessionCloses()).toBe(1)

    expect(await getStatus(harness)).toMatchObject({ state: 'idle' })
    // The log keeps saying what it always said: the claim was acknowledged, the
    // audit trail was not edited (ADR 0007).
    expect(fs.readFileSync(logPath(harness.config)).equals(before)).toBe(true)
    expect(fs.readdirSync(harness.config.logDir)).toEqual([LOG_NAME])

    const start = await postStart(harness)
    expect(start.status).toBe(202)
    expect(await start.json()).toMatchObject({ started: true })
    expect(harness.starts()).toBe(1)
  })
})

describe('cleaning up under a Run in flight', () => {
  it('is refused with the one-at-a-time reason, and touches nothing', async () => {
    const harness = await serve()
    // Written after start-up: this one appeared while the Console was open, so
    // its recent write is evidence of a Run in flight.
    writeLog(harness.config, runLog(plainLine('still going')))
    const before = fs.readFileSync(logPath(harness.config))
    expect(await getStatus(harness)).toMatchObject({ state: 'running' })

    const response = await postCleanup(harness)

    expect(response.status).toBe(409)
    const body: unknown = await response.json()
    expect(body).toMatchObject({ cleaned: false })
    expect(body).toMatchObject({ reason: expect.stringMatching(/already in flight/i) })
    // A live Run's Browser session is never closed under it.
    expect(harness.sessionCloses()).toBe(0)
    expect(fs.readFileSync(logPath(harness.config)).equals(before)).toBe(true)
  })
})

describe('POST /api/run/cleanup', () => {
  it('refuses a GET, naming POST', async () => {
    const harness = await serve()

    const response = await fetch(`${harness.service.origin}/api/run/cleanup?token=${TOKEN}`)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })
})
