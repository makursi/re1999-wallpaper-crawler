import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ConsoleConfig } from '../../src/console/console-config.js'
import type { ConsoleServerDeps, ConsoleService } from '../../src/console/server.js'
import { startConsoleServer } from '../../src/console/server.js'
import { IDLE_RUN_FACTS, UNREAD_GALLERY_FACTS } from '../../src/console/status.js'

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

/** The names Vite emits: one content hash per asset, referenced relatively. */
const ASSET_JS = 'assets/index-BO_xJMyK.js'
const ASSET_CSS = 'assets/index-3uP6b3CG.css'

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Console</title>
    <script type="module" crossorigin src="./${ASSET_JS}"></script>
    <link rel="stylesheet" crossorigin href="./${ASSET_CSS}" />
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`

const roots: string[] = []
const openServices: ConsoleService[] = []
const openServers: http.Server[] = []

afterEach(async () => {
  await Promise.all(openServices.splice(0).map(service => service.close()))
  await Promise.all(openServers.splice(0).map(server => close(server)))
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/**
 * A directory tree standing in for the repository, built as data: a Mirror with
 * two images, one non-image name and the Gallery state file, a Run log
 * directory, and a built page.
 */
function fixture(): ConsoleConfig {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'console-test-'))
  roots.push(projectRoot)

  const imagesDir = path.join(projectRoot, 'images')
  fs.mkdirSync(imagesDir)
  fs.writeFileSync(path.join(imagesDir, '1013_8dee54e8bf644722981751524fb54356.png'), 'a')
  fs.writeFileSync(path.join(imagesDir, '1014_11a9938e23a347ca8580098ddfd5a190.jpg'), 'b')
  // A non-image name and a dotfile: the Mirror count has to include the first
  // and skip the second (see tests/console/mirror.test.ts).
  fs.writeFileSync(path.join(imagesDir, 'notes.txt'), 'c')
  fs.writeFileSync(path.join(imagesDir, '.gallery-state.json'), '{}')

  const logDir = path.join(projectRoot, 'logs')
  fs.mkdirSync(logDir)

  const distDir = path.join(projectRoot, 'dist')
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(distDir, 'index.html'), INDEX_HTML)
  fs.writeFileSync(path.join(distDir, ASSET_JS), 'export {}\n')
  fs.writeFileSync(path.join(distDir, ASSET_CSS), 'body { margin: 0 }\n')

  return {
    projectRoot,
    imagesDir,
    logDir,
    galleryStateFile: path.join(imagesDir, '.gallery-state.json'),
    distDir,
    galleryListEndpoint: 'https://gallery.test/query',
  }
}

async function serve(overrides: Partial<ConsoleServerDeps> = {}): Promise<ConsoleService> {
  const service = await startConsoleServer(fixture(), {
    runState: () => IDLE_RUN_FACTS,
    galleryFacts: () => UNREAD_GALLERY_FACTS,
    startRun: async () => ({ started: false, reason: 'starting a Run is not implemented yet' }),
    token: TOKEN,
    port: 0,
    ...overrides,
  })
  openServices.push(service)
  return service
}

interface RawResponse {
  status: number
  body: string
  headers: http.IncomingHttpHeaders
}

/**
 * `fetch` refuses to send a `Host` or an `Origin` header — both are forbidden
 * header names — so the guard's two browser-identity cases need a raw request.
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

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections()
    server.close(error => (error === undefined ? resolve() : reject(error)))
  })
}

function portOf(server: http.Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server is not bound')
  return address.port
}

describe('GET /api/status', () => {
  it('answers the payload the page and the service share', async () => {
    const service = await serve()

    const response = await fetch(`${service.origin}/api/status?token=${TOKEN}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await response.json()).toEqual({
      runId: null,
      state: 'idle',
      startedAt: null,
      // The two images plus `notes.txt`; `.gallery-state.json` is skipped.
      mirrorCount: 3,
      officialTotal: null,
      verdict: null,
      defects: null,
      listAvailable: false,
      // #34's additive fields: the newest Run report, and whether the newest
      // log carries a `run_report` record at all.
      report: null,
      reportPresent: false,
    })
  })

  it('takes the Run and Gallery halves from the injected readers', async () => {
    const service = await serve({
      runState: () => ({
        runId: '2026-10-18T01-03-31',
        state: 'running',
        startedAt: '2026-10-18T01:03:31.856Z',
        verdict: null,
        defects: null,
        report: null,
        reportPresent: false,
      }),
      galleryFacts: () => ({ officialTotal: 1010, listAvailable: true }),
    })

    const response = await fetch(`${service.origin}/api/status?token=${TOKEN}`)

    expect(await response.json()).toMatchObject({
      runId: '2026-10-18T01-03-31',
      state: 'running',
      startedAt: '2026-10-18T01:03:31.856Z',
      officialTotal: 1010,
      listAvailable: true,
    })
  })
})

describe('the request guard', () => {
  it('refuses a request with no token, and one with a wrong token', async () => {
    const service = await serve()

    expect((await fetch(`${service.origin}/api/status`)).status).toBe(403)
    expect((await fetch(`${service.origin}/`)).status).toBe(403)
    expect((await fetch(`${service.origin}/api/status?token=not-the-token`)).status).toBe(403)
  })

  it('refuses a foreign Origin but not an absent one', async () => {
    const service = await serve()

    const foreign = await rawRequest(service, `/api/status?token=${TOKEN}`, {
      headers: { origin: 'http://evil.example' },
    })
    expect(foreign.status).toBe(403)
    expect(JSON.parse(foreign.body)).toEqual({ error: 'forbidden' })

    // The page's own case: a top-level navigation and a same-origin GET send no
    // Origin at all, so requiring one would refuse the Console itself.
    const absent = await rawRequest(service, `/api/status?token=${TOKEN}`)
    expect(absent.status).toBe(200)
  })

  it('refuses a Host that is not the bound authority (DNS rebinding)', async () => {
    const service = await serve()

    const response = await rawRequest(service, `/api/status?token=${TOKEN}`, {
      headers: { host: 'evil.example:8791' },
    })

    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toEqual({ error: 'forbidden' })
  })

  it('accepts either loopback authority the service bound', async () => {
    const service = await serve()

    const localhost = await rawRequest(service, `/api/status?token=${TOKEN}`, {
      headers: { host: `localhost:${service.port}` },
    })

    expect(localhost.status).toBe(200)
  })

  it('checks the token before the route, for a write method too', async () => {
    const service = await serve()

    const response = await rawRequest(service, '/api/status', { method: 'POST' })

    expect(response.status).toBe(403)
  })
})

describe('the built page', () => {
  it('serves dist/index.html with the token on every asset URL', async () => {
    const service = await serve()

    const response = await fetch(`${service.origin}/?token=${TOKEN}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await response.text()
    // A `<script>`/`<link>` cannot attach a query string of its own, so the
    // service puts the token on the emitted URLs; without this the bundle would
    // be refused and the page would be blank.
    expect(html).toContain(`src="./${ASSET_JS}?token=${TOKEN}"`)
    expect(html).toContain(`href="./${ASSET_CSS}?token=${TOKEN}"`)
  })

  it('serves an asset with the token and refuses it without', async () => {
    const service = await serve()

    const withToken = await fetch(`${service.origin}/${ASSET_JS}?token=${TOKEN}`)

    expect(withToken.status).toBe(200)
    expect(withToken.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(withToken.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await withToken.text()).toBe('export {}\n')

    expect((await fetch(`${service.origin}/${ASSET_JS}`)).status).toBe(403)
  })

  it('cannot be talked out of the build directory', async () => {
    const service = await serve()

    const traversal = await fetch(
      `${service.origin}/assets/%2e%2e%2f%2e%2e%2fpackage.json?token=${TOKEN}`,
    )

    expect(traversal.status).toBe(404)
  })
})

describe('startConsoleServer', () => {
  it('binds another port when the preferred one is taken, and reports the one it bound', async () => {
    const taken = http.createServer()
    openServers.push(taken)
    await new Promise<void>((resolve, reject) => {
      taken.once('error', reject)
      taken.listen(0, '127.0.0.1', () => resolve())
    })
    const takenPort = portOf(taken)

    const service = await serve({ port: takenPort })

    expect(service.fellBack).toBe(true)
    expect(service.port).not.toBe(takenPort)
    expect(service.origin).toBe(`http://127.0.0.1:${service.port}`)
    expect(service.url).toBe(`http://127.0.0.1:${service.port}/?token=${TOKEN}`)
    expect((await fetch(`${service.origin}/api/status?token=${TOKEN}`)).status).toBe(200)
  })

  it('answers 404 for an unknown route and 405 for a wrong method on a known one', async () => {
    const service = await serve()

    expect((await fetch(`${service.origin}/api/nope?token=${TOKEN}`)).status).toBe(404)
    expect((await fetch(`${service.origin}/?token=${TOKEN}`)).status).toBe(200)

    const wrongMethod = await rawRequest(service, `/api/status?token=${TOKEN}`, { method: 'POST' })

    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.allow).toBe('GET')
  })
})
