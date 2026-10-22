// ── The page's exit over HTTP (#96) ─────────────────────────────────
//
// The seam is the bound service on a real socket, as the sibling route suites
// use it: `POST /api/exit` with a JSON body `{"confirm": boolean}` behind the
// token / Host / Origin guard. The exit's controller is the real one
// (`web/server/run-control.ts`); only its launcher and its shutdown are
// injected, so nothing here can kill a process or close a service for real.
//
// The two answers the page acts on are pinned as data: an idle exit is `202`
// at once, and a Run in flight is `409` with `exit-confirm-required` until the
// caller confirms. A Run a terminal started is still a stop of the service
// only, and the test can see that in the outcome the composition root is given.

import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ConsoleConfig } from '../../../web/server/console-config.js'
import type { ExitOutcome, RunLauncher } from '../../../web/server/run-control.js'
import { createExitController } from '../../../web/server/run-control.js'
import type { RunLogSource } from '../../../web/server/run-log-source.js'
import { createRunLogSource } from '../../../web/server/run-log-source.js'
import type { ConsoleService } from '../../../web/server/server.js'
import { startConsoleServer } from '../../../web/server/server.js'
import {
  consoleConfigIn,
  fixtureAppRoot,
  LOG_NAME,
  plainLine,
  runLog,
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
  /** What the composition root was asked to shut down, in order. */
  shutdowns: ExitOutcome[]
  /** How many times the launcher's tree was killed. */
  kills: () => number
}

interface ServeOptions {
  /** A Run this Console started: the launcher holds the live child. */
  ownsRun?: boolean
  /** A Run started from a terminal: a log written after start-up, unfinished. */
  terminalRun?: boolean
  /** A status-only service, as #32's shape is: no exit action to offer. */
  withoutExit?: boolean
}

/**
 * The real service over a fixture repository, with the launcher and the
 * shutdown injected so nothing is ever spawned or closed.
 */
async function serve(options: ServeOptions = {}): Promise<Harness> {
  const projectRoot = fixtureAppRoot('console-exit-api-')
  roots.push(projectRoot)
  const config = consoleConfigIn(projectRoot)

  let alive = options.ownsRun ?? false
  let kills = 0
  const launcher: RunLauncher = {
    start: () => {
      alive = true
    },
    isAlive: () => alive,
    stop: () => {
      kills++
      alive = false
    },
  }

  const source = createRunLogSource({
    logDir: config.logDir,
    galleryStateFile: config.galleryStateFile,
    imagesDir: config.imagesDir,
    liveChild: () => launcher.isAlive(),
  })

  // Written after the source captured its start-up listing: a recent,
  // unfinished log that appeared while the Console was open is a Run a terminal
  // started, exactly as §6a reads it.
  if (options.terminalRun === true) {
    fs.writeFileSync(
      path.join(config.logDir, LOG_NAME),
      `${runLog(plainLine('5. Downloading images...'))}\n`,
      'utf8',
    )
  }

  const shutdowns: ExitOutcome[] = []
  const exitProgram = createExitController({
    runState: () => source.facts().state,
    launcher,
    shutdown: outcome => shutdowns.push(outcome),
    // The real controller waits a short beat so the answer is written first; a
    // test needs the order, not the wall clock.
    schedule: run => run(),
  })

  const service = await startConsoleServer(config, {
    runState: () => source.facts(),
    galleryFacts: () => ({ officialTotal: 1010, listAvailable: true }),
    startRun: async () => ({ started: false, refusal: null }),
    ...(options.withoutExit === true ? {} : { exitProgram }),
    token: TOKEN,
    port: 0,
  })
  services.push(service)

  return { service, config, source, shutdowns, kills: () => kills }
}

/** The page's own request: a JSON body, and only `confirm` in it. */
function postExit(harness: Harness, body?: unknown): Promise<Response> {
  return fetch(`${harness.service.origin}/api/exit?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

interface RawResponse {
  status: number
  body: string
  headers: http.IncomingHttpHeaders
}

/** `fetch` refuses to send an `Origin`, so the foreign-origin case is raw. */
function rawRequest(
  service: ConsoleService,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<RawResponse> {
  const url = new URL(`/api/exit?token=${TOKEN}`, service.origin)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? 'POST',
        headers: options.headers,
      },
      res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('POST /api/exit with no Run in flight', () => {
  it('stops the service at once, with the 202 the page acts on', async () => {
    const harness = await serve()

    const response = await postExit(harness, { confirm: false })

    expect(response.status).toBe(202)
    // The accepted body is exactly `{"exiting": true}` (spec #93): no refusal
    // field to explain an answer that permitted the exit.
    expect(await response.json()).toEqual({ exiting: true })
    expect(harness.shutdowns).toEqual([{ runInFlight: false, killedOwnRun: false }])
  })

  it('asks one confirmation only when a Run is in flight — an idle exit has none', async () => {
    // The spec's "no confirmation for an idle exit": an empty or absent body is
    // still a `202` when there is nothing to protect.
    const harness = await serve()

    expect((await postExit(harness)).status).toBe(202)
  })
})

describe('POST /api/exit with a Run in flight', () => {
  it('is refused with exit-confirm-required before the caller confirms', async () => {
    const harness = await serve({ terminalRun: true })

    const response = await postExit(harness, { confirm: false })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      exiting: false,
      refusal: { code: 'exit-confirm-required', missing: [] },
    })
    expect(harness.shutdowns).toEqual([])
    expect(harness.kills()).toBe(0)
  })

  it('treats a missing or malformed body as unconfirmed, never as consent', async () => {
    const harness = await serve({ terminalRun: true })

    expect((await postExit(harness)).status).toBe(409)
    expect(await (await postExit(harness, 'not an object')).json()).toMatchObject({
      exiting: false,
      refusal: { code: 'exit-confirm-required' },
    })
    expect(harness.shutdowns).toEqual([])
  })

  it('lets a confirmed exit stop the service, and says the Run was not ours', async () => {
    // A terminal Run: the service goes, the Run may keep writing, and no tree is
    // killed because this Console never held it.
    const harness = await serve({ terminalRun: true })

    const response = await postExit(harness, { confirm: true })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ exiting: true })
    expect(harness.kills()).toBe(0)
    expect(harness.shutdowns).toEqual([{ runInFlight: true, killedOwnRun: false }])
  })

  it('kills the tree this Console started when the exit is confirmed', async () => {
    const harness = await serve({ ownsRun: true })

    const response = await postExit(harness, { confirm: true })

    expect(response.status).toBe(202)
    expect(harness.kills()).toBe(1)
    expect(harness.shutdowns).toEqual([{ runInFlight: true, killedOwnRun: true }])
  })

  it('answers a repeated exit without scheduling a second shutdown', async () => {
    const harness = await serve()

    await postExit(harness, { confirm: true })
    const again = await postExit(harness, { confirm: true })

    expect(again.status).toBe(202)
    expect(harness.shutdowns).toHaveLength(1)
  })
})

describe('POST /api/exit, the guard and the method', () => {
  it('refuses a GET, naming POST', async () => {
    const harness = await serve()

    const response = await fetch(`${harness.service.origin}/api/exit?token=${TOKEN}`)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })

  it('refuses a request with no token before the route sees it', async () => {
    const harness = await serve()

    const response = await fetch(`${harness.service.origin}/api/exit`, { method: 'POST' })

    expect(response.status).toBe(403)
    expect(harness.shutdowns).toEqual([])
  })

  it('refuses a foreign origin, and kills nothing', async () => {
    const harness = await serve({ ownsRun: true })

    const response = await rawRequest(harness.service, {
      headers: { origin: 'http://evil.example' },
    })

    expect(response.status).toBe(403)
    expect(harness.kills()).toBe(0)
    expect(harness.shutdowns).toEqual([])
  })

  it('answers 404 when the service has no exit action to offer', async () => {
    // Additive contract: a status-only service is a real service, and claiming
    // it would exit would be a lie.
    const harness = await serve({ withoutExit: true })

    expect((await postExit(harness, { confirm: true })).status).toBe(404)
  })
})
