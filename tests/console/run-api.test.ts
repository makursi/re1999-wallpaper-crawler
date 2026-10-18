import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ConsoleConfig } from '../../src/console/console-config.js'
import type { RunLauncher } from '../../src/console/run-control.js'
import { createRunStarter } from '../../src/console/run-control.js'
import { createRunLogSource } from '../../src/console/run-log-source.js'
import type { ConsoleService } from '../../src/console/server.js'
import { startConsoleServer } from '../../src/console/server.js'
import { galleryState, LOG_NAME, NEW_FILES, plainLine, runLog, runReport } from './run-fixtures.js'

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

const roots: string[] = []
const services: ConsoleService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.close()))
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

interface Harness {
  service: ConsoleService
  config: ConsoleConfig
  /** How many times the launcher was asked to start; must stay 0 on refusals. */
  starts: () => number
}

interface ServeOptions {
  /** The names the injected prerequisite check reports as missing. */
  prerequisites?: string[]
  officialTotal?: number | null
  listAvailable?: boolean
}

/**
 * A fixture repository — an empty Mirror, an empty log directory, no `.env` —
 * and the real service over it, with the launcher and the prerequisite check
 * injected so nothing is ever spawned.
 */
async function serve(options: ServeOptions = {}): Promise<Harness> {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'console-run-api-'))
  roots.push(projectRoot)
  const imagesDir = path.join(projectRoot, 'images')
  const logDir = path.join(projectRoot, 'logs')
  fs.mkdirSync(imagesDir)
  fs.mkdirSync(logDir)

  const config: ConsoleConfig = {
    projectRoot,
    imagesDir,
    logDir,
    galleryStateFile: path.join(imagesDir, '.gallery-state.json'),
    distDir: path.join(projectRoot, 'dist'),
    galleryListEndpoint: 'https://gallery.test/query',
  }

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
    logDir,
    galleryStateFile: config.galleryStateFile,
    imagesDir,
    liveChild: () => launcher.isAlive(),
  })
  const startRun = createRunStarter({
    launcher,
    // A Run started from a terminal is in flight too — the log says so.
    isRunInFlight: () => source.facts().state === 'running',
    missingPrerequisites: () => options.prerequisites ?? [],
  })

  const service = await startConsoleServer(config, {
    runState: () => source.facts(),
    galleryFacts: () => ({
      officialTotal: options.officialTotal ?? 1010,
      listAvailable: options.listAvailable ?? true,
    }),
    startRun,
    token: TOKEN,
    port: 0,
  })
  services.push(service)

  return { service, config, starts: () => starts }
}

function writeLog(config: ConsoleConfig, text: string): void {
  fs.writeFileSync(path.join(config.logDir, LOG_NAME), `${text}\n`, 'utf8')
}

function writeState(config: ConsoleConfig): void {
  fs.writeFileSync(config.galleryStateFile, JSON.stringify(galleryState()), 'utf8')
}

/** The status payload, as the page reads it — no assertion about its shape here. */
async function getStatus(harness: Harness): Promise<unknown> {
  const response = await fetch(`${harness.service.origin}/api/status?token=${TOKEN}`)
  expect(response.status).toBe(200)
  return response.json()
}

function postStart(harness: Harness): Promise<Response> {
  return fetch(`${harness.service.origin}/api/run?token=${TOKEN}`, { method: 'POST' })
}

interface RawResponse {
  status: number
  body: string
  headers: http.IncomingHttpHeaders
}

/**
 * `fetch` refuses to send an `Origin` header — it is a forbidden header name —
 * so the foreign-origin start needs a raw request.
 */
function rawRequest(
  service: ConsoleService,
  urlPath: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<RawResponse> {
  const url = new URL(urlPath, service.origin)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? 'GET',
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

describe('POST /api/run', () => {
  it('starts exactly one Run when nothing is in flight', async () => {
    const harness = await serve()

    const response = await postStart(harness)

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ started: true, reason: null })
    expect(harness.starts()).toBe(1)
  })

  it('refuses a second start while one runs, and the refusal states why', async () => {
    const harness = await serve()
    await postStart(harness)

    const second = await postStart(harness)

    expect(second.status).toBe(409)
    const body: unknown = await second.json()
    expect(body).toMatchObject({ started: false })
    expect(body).toMatchObject({ reason: expect.stringMatching(/already in flight/i) })
    // The reason ADR 0009 insists on: one persistent Browser session.
    expect(body).toMatchObject({ reason: expect.stringMatching(/session/i) })
    expect(harness.starts()).toBe(1)
  })

  it('names a missing prerequisite and starts nothing', async () => {
    const harness = await serve({ prerequisites: ['chrome', 'tsx entry'] })

    const response = await postStart(harness)

    expect(response.status).toBe(412)
    const body: unknown = await response.json()
    expect(body).toMatchObject({ started: false, missing: ['chrome', 'tsx entry'] })
    expect(body).toMatchObject({ reason: expect.stringContaining('chrome') })
    expect(harness.starts()).toBe(0)
  })

  it('starts nothing when the request comes from a foreign origin', async () => {
    const harness = await serve()

    const response = await rawRequest(harness.service, `/api/run?token=${TOKEN}`, {
      method: 'POST',
      headers: { origin: 'http://evil.example' },
    })

    expect(response.status).toBe(403)
    expect(harness.starts()).toBe(0)
  })

  it('refuses a start with no token, and a GET of the same route', async () => {
    const harness = await serve()

    const untokened = await fetch(`${harness.service.origin}/api/run`, { method: 'POST' })
    expect(untokened.status).toBe(403)

    const wrongMethod = await fetch(`${harness.service.origin}/api/run?token=${TOKEN}`)
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('POST')

    expect(harness.starts()).toBe(0)
  })
})

describe('a Run started from a terminal', () => {
  it('reads running while its log is unfinished, then idle with its verdict', async () => {
    const harness = await serve()

    expect(await getStatus(harness)).toMatchObject({ state: 'idle' })

    // The Run begins: a log appears, and the Mirror gains the files it claims.
    writeLog(harness.config, runLog(plainLine('5. Downloading images...')))
    writeState(harness.config)
    for (const name of NEW_FILES) {
      fs.writeFileSync(path.join(harness.config.imagesDir, name), 'a')
    }

    // No verdict while the Run is in flight — the log is not finished.
    expect(await getStatus(harness)).toMatchObject({ state: 'running', verdict: null })

    // It ends: the report lands, and the verdict appears with it.
    writeLog(harness.config, runLog(plainLine('done'), JSON.stringify(runReport())))

    const finished = await getStatus(harness)
    expect(finished).toMatchObject({ state: 'idle', verdict: 'clean', reportPresent: true })
    expect(finished).toMatchObject({ report: { runId: '2026-10-18T01-03-31' } })
  })

  it('is refused a second start over HTTP while its log is unfinished', async () => {
    const harness = await serve()
    writeLog(harness.config, runLog(plainLine('still going')))

    expect((await postStart(harness)).status).toBe(409)
    expect(harness.starts()).toBe(0)
  })
})

describe('the status view over HTTP', () => {
  it('expresses progress as the Mirror count against the Gallery total', async () => {
    const harness = await serve({ officialTotal: 1010 })
    // The log holds only `run_meta` and the closing `run_report`: no per-file
    // record is needed for progress to work (spec decision 8).
    writeLog(harness.config, runLog(JSON.stringify(runReport())))
    for (const name of ['1013_a.png', '1014_b.jpg', 'notes.txt']) {
      fs.writeFileSync(path.join(harness.config.imagesDir, name), 'a')
    }
    fs.writeFileSync(harness.config.galleryStateFile, JSON.stringify(galleryState()), 'utf8')

    // Every non-dot name counts, images and non-images alike (conventions §4a).
    expect(await getStatus(harness)).toMatchObject({
      mirrorCount: 3,
      officialTotal: 1010,
      listAvailable: true,
    })
  })

  it('works with no .env present', async () => {
    const harness = await serve()

    expect(fs.existsSync(path.join(harness.config.projectRoot, '.env'))).toBe(false)
    expect(await getStatus(harness)).toMatchObject({ state: 'idle' })
  })

  it('never writes the Mirror or the Gallery state', async () => {
    const harness = await serve()
    fs.writeFileSync(path.join(harness.config.imagesDir, '1013_a.png'), 'a')
    const stateText = JSON.stringify(galleryState(), null, 2)
    fs.writeFileSync(harness.config.galleryStateFile, stateText, 'utf8')
    writeLog(harness.config, runLog(JSON.stringify(runReport())))
    const mirrorBefore = fs.readdirSync(harness.config.imagesDir).toSorted()

    await getStatus(harness)
    await postStart(harness)
    await getStatus(harness)

    expect(fs.readFileSync(harness.config.galleryStateFile, 'utf8')).toBe(stateText)
    expect(fs.readdirSync(harness.config.imagesDir).toSorted()).toEqual(mirrorBefore)
  })
})
