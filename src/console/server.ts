// ── The Console's HTTP surface ──────────────────────────────────────
//
// One port serves the built page and the API (spec decision 14), bound to
// loopback only. Every request — the page, its assets and the API alike — is
// checked against this start's token and the authority the service bound
// (spec decision 13), because a page the owner happens to be visiting must not
// be able to start a Run on their machine.
//
// Everything the server needs arrives by injection (spec decision 29): the
// configuration value and the three readers. `src/console.ts` is the only
// place that reads `src/config.ts`, which is what keeps `tests/**` free of a
// `.env`.

import { timingSafeEqual } from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'

import type { ConsoleRunStartPayload } from './api-types.js'
import type { ConsoleConfig } from './console-config.js'
import type { GalleryListSource } from './gallery-list-source.js'
import { buildGalleryView, toGalleryPayload } from './gallery-view.js'
import { resolveMirrorFile, MIRROR_REFUSALS } from './mirror-files.js'
import { countMirrorNames, countMirrorWallpapers, readMirrorNames } from './mirror.js'
import type { ConsoleGalleryFacts, ConsoleRunFacts } from './status.js'
import { buildStatus } from './status.js'
import type { ThumbnailGenerator } from './thumbnails.js'
import {
  ensureThumbnail,
  realThumbnailCache,
  realThumbnailGenerator,
  THUMBNAIL_CACHE_DIR_NAME,
} from './thumbnails.js'

/**
 * What a start request answers. Declared here so #34 implements one shape: the
 * body is the page's `ConsoleRunStartPayload`, and `status` is the HTTP status
 * the refusal carries (409 when a Run is already in flight, 412 when a global
 * prerequisite is missing).
 */
export interface RunStartResult extends ConsoleRunStartPayload {
  status?: number
}

/** Starts a Run (spec decision 6). #32 fixes the seam; #34 implements it. */
export type RunStarter = () => Promise<RunStartResult>

/**
 * Image bytes for one thumbnail, generated — or read back from the cache —
 * after the request has been validated (#35).
 *
 * Injected like every other outside touch (spec decision 29), for one specific
 * reason: the image library's native addon may be absent or broken, and a test
 * must be able to assert the 500 that follows without owning that failure mode.
 * `src/console.ts` injects the real one; a service given none answers a named
 * 500 rather than crashing.
 */
export interface ThumbnailSource {
  thumbnail: (name: string, sourceFile: string) => Promise<Buffer>
}

/**
 * The real source: the cached thumbnail, generated once if it is missing. The
 * cache lives under the project root — never inside the Mirror (ADR 0010) —
 * and the name that keys it is the Wallpaper's own, which embeds a content
 * hash, so a hit needs no invalidation.
 */
export function realThumbnailSource(
  projectRoot: string,
  generator: ThumbnailGenerator = realThumbnailGenerator,
): ThumbnailSource {
  const cacheDir = path.join(projectRoot, THUMBNAIL_CACHE_DIR_NAME)
  return {
    thumbnail: async (name, sourceFile) => {
      const imagesDir = path.dirname(sourceFile)
      const file = await ensureThumbnail(name, {
        imagesDir,
        cacheDir,
        generate: generator,
        cache: realThumbnailCache,
      })
      return fs.readFileSync(file)
    },
  }
}

export interface ConsoleServerDeps {
  /** The status's Run half. #32 injects the idle state; #34/#36 read the log. */
  runState: () => ConsoleRunFacts
  /** The status's Gallery half. #32 injects "not read"; #33 fetches the list. */
  galleryFacts: () => ConsoleGalleryFacts | Promise<ConsoleGalleryFacts>
  /** The Run starter (`createRunStarter`): `POST /api/run`'s whole answer. */
  startRun: RunStarter
  /** This start's access token, generated per start and never persisted. */
  token: string
  /** The port to prefer; `0` asks the OS for one (tests). */
  port: number
  /**
   * The cached Gallery list `GET /api/gallery` reads (#33). The entry injects
   * the same source behind `galleryFacts`, so the two routes cannot disagree
   * about whether the list was read.
   *
   * Optional on purpose: a service that only answers `/api/status` — #32's
   * shape and its tests — legitimately has no list, and the gallery route's
   * honest answer to that is the degraded view ("the list was not read"), not
   * a 500 and not a fabricated empty list.
   */
  galleryList?: GalleryListSource
  /**
   * The newest Run report's `gallery.newSinceLastRun` (#33): read from the log
   * the same way `check-run` picks it, never recomputed from the Gallery state
   * (recomputing gives 0). Absent or `null` = nothing to report.
   */
  newSinceLastRun?: () => number | null
  /**
   * The thumbnail generator (#35). `src/console.ts` injects the real one;
   * absent means "this service cannot render", which the route answers as a
   * named 500 — never a crash and never a 404.
   */
  thumbnailSource?: ThumbnailSource
}

export interface ConsoleService {
  /** `http://127.0.0.1:<port>` — the authority every request has to present. */
  origin: string
  /** The port actually bound, never the requested one (spec decision 3). */
  port: number
  /** `true` when the preferred port was taken and the OS assigned another. */
  fellBack: boolean
  /** The page's URL with the token on it — what the entry prints and opens. */
  url: string
  close: () => Promise<void>
}

const ASSET_PREFIX = '/assets/'
const THUMBNAIL_PREFIX = '/api/thumbnail/'
const THUMBNAIL_ROUTE = '/api/thumbnail'
const IMAGE_PREFIX = '/api/image/'
const IMAGE_ROUTE = '/api/image'

/** What a served file's extension means over HTTP (notes 02 §7). */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** `true` for either image route's path, with or without a name after it. */
function isImageRoute(pathname: string): boolean {
  for (const route of [THUMBNAIL_ROUTE, IMAGE_ROUTE]) {
    if (pathname === route || pathname.startsWith(`${route}/`)) return true
  }
  return false
}

/**
 * One image response: the bytes, their type, and `nosniff` so a browser cannot
 * decide the type for itself. A year-long cache is honest on both routes — a
 * Wallpaper's name embeds a content hash, and so does the thumbnail derived
 * from it (notes 02 §7).
 */
function sendImageBytes(res: http.ServerResponse, bytes: Buffer, contentType: string): void {
  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  res.end(bytes)
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/**
 * Bind the service. The preferred port is tried first and an OS-assigned one
 * is used when it is taken — a page that refuses to start because a port is
 * busy is the worst available failure mode (spec decision 3). The returned port
 * is always the one actually bound, never the requested one.
 */
export async function startConsoleServer(
  config: ConsoleConfig,
  deps: ConsoleServerDeps,
): Promise<ConsoleService> {
  // The guard needs the bound port, and a request cannot arrive before
  // `listen` has resolved and this assignment has run.
  let boundPort = 0
  const server = http.createServer((req, res) => {
    handleRequest(req, res, config, deps, boundPort).catch(() => {
      // The handler threw before answering: a socket left open would be worse
      // than a named 500.
      if (res.headersSent) res.destroy()
      else sendJson(res, 500, { error: 'the Console failed to answer' })
    })
  })

  const { port, fellBack } = await listenWithFallback(server, deps.port)
  boundPort = port
  const origin = `http://127.0.0.1:${port}`

  return {
    origin,
    port,
    fellBack,
    url: `${origin}/?token=${encodeURIComponent(deps.token)}`,
    close: () => closeServer(server),
  }
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ConsoleConfig,
  deps: ConsoleServerDeps,
  port: number,
): Promise<void> {
  if (port === 0) {
    sendJson(res, 500, { error: 'the Console is not listening' })
    return
  }

  // Parse the target as WHATWG URL so plain `..` segments are collapsed before
  // routing; encoded ones survive and are handled by `sendAsset`.
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

  if (!isAuthorized(req, url, port, deps.token)) {
    sendJson(res, 403, { error: 'forbidden' })
    return
  }

  if (url.pathname === '/api/status') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' }, { allow: 'GET' })
      return
    }
    sendJson(
      res,
      200,
      buildStatus({
        run: deps.runState(),
        mirrorCount: countMirrorWallpapers(config.imagesDir),
        gallery: await deps.galleryFacts(),
      }),
    )
    return
  }

  // ── GET /api/gallery (#33) ────────────────────────────────────────
  //
  // The Gallery list read against the Mirror: one row per entry, the Mirror's
  // extras after them, the gap as set arithmetic, and the newest Run's
  // `newSinceLastRun`. All the deciding is in the pure `buildGalleryView`; this
  // block only gathers its three inputs.
  if (url.pathname === '/api/gallery') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' }, { allow: 'GET' })
      return
    }
    const list = deps.galleryList === undefined ? null : await deps.galleryList.get()
    // One read of the Mirror, so the rows and the count cannot describe two
    // different directories.
    const diskFiles = readMirrorNames(config.imagesDir)
    sendJson(
      res,
      200,
      toGalleryPayload(
        buildGalleryView({
          list,
          diskFiles,
          newSinceLastRun: deps.newSinceLastRun?.() ?? null,
        }),
        countMirrorNames(diskFiles),
      ),
    )
    return
  }
  // ── end GET /api/gallery ──────────────────────────────────────────

  // ── GET /api/thumbnail/<name> and GET /api/image/<name> (#35) ─────
  //
  // Two routes, one block, because they share the whole of their safety: the
  // name comes from the URL, `resolveMirrorFile` is what turns it into a path
  // (or a refusal), and that resolution — not the image library — is what the
  // 404/500 boundary is made of. A well-formed name that is not in the Mirror
  // is a missing file; only a name that resolved can fail to render.
  if (isImageRoute(url.pathname)) {
    const isThumbnail = url.pathname.startsWith(THUMBNAIL_PREFIX)
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' }, { allow: 'GET' })
      return
    }

    // The token is already checked: `isAuthorized` refuses an absent, wrong,
    // foreign or misdirected request before any route is reached.
    const prefix = isThumbnail ? THUMBNAIL_PREFIX : IMAGE_PREFIX
    // `/api/image` with no name is an empty name, which the resolver refuses —
    // the route does not need its own case for it.
    const name = url.pathname.length <= prefix.length ? '' : url.pathname.slice(prefix.length)
    const resolved = resolveMirrorFile(config.imagesDir, name)
    if (!resolved.ok) {
      // A malformed name and a name that is merely not there are different
      // answers: 400 says the request was wrong, 404 says the Wallpaper is not
      // in the Mirror. The invalid-name message never carries a path.
      sendJson(
        res,
        resolved.reason === MIRROR_REFUSALS.notListed ? 404 : 400,
        resolved.reason === MIRROR_REFUSALS.notListed
          ? { error: 'missing file' }
          : { error: 'invalid name' },
      )
      return
    }

    const extension = path.extname(resolved.path).toLowerCase()
    const contentType = IMAGE_CONTENT_TYPES[extension] ?? 'application/octet-stream'
    if (!isThumbnail) {
      sendImageBytes(res, fs.readFileSync(resolved.path), contentType)
      return
    }

    if (deps.thumbnailSource === undefined) {
      // A service that cannot render (a broken native binary surfaces as a
      // rejected dynamic import at this very call site) answers a named 500;
      // the route survives and the next request retries.
      sendJson(res, 500, { error: 'thumbnail failed' })
      return
    }
    let bytes: Buffer
    try {
      bytes = await deps.thumbnailSource.thumbnail(path.basename(resolved.path), resolved.path)
    } catch {
      sendJson(res, 500, { error: 'thumbnail failed' })
      return
    }
    sendImageBytes(res, bytes, contentType)
    return
  }
  // ── end GET /api/thumbnail/<name> and GET /api/image/<name> ───────

  // ── POST /api/run (#34) ───────────────────────────────────────────
  //
  // The answer is only whether the start was accepted, and why it was refused:
  // a Run's identity is its Run log, never this handle, so the next
  // `/api/status` reports it from the log directory and a Run started from a
  // terminal looks identical (spec decision 7). The refusals are the two the
  // page can act on — 409 for a Run already in flight, 412 with the missing
  // prerequisite's name — and the starter decides which (run-control.ts).
  if (url.pathname === '/api/run') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST' })
      return
    }
    const result = await deps.startRun()
    const payload: ConsoleRunStartPayload = { started: result.started, reason: result.reason }
    if (result.missing !== undefined) payload.missing = result.missing
    sendJson(res, result.status ?? (result.started ? 202 : 409), payload)
    return
  }
  // ── end POST /api/run ─────────────────────────────────────────────

  if (req.method !== 'GET') {
    sendJson(res, 404, { error: 'not found' })
    return
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    sendPage(res, config.distDir, deps.token)
    return
  }

  if (url.pathname.startsWith(ASSET_PREFIX)) {
    sendAsset(res, config.distDir, url.pathname)
    return
  }

  sendJson(res, 404, { error: 'not found' })
}

/**
 * The request guard (spec decision 13; .console-notes/00-conventions.md §5).
 *
 * 1. **Host** has to be the authority the service bound — the DNS-rebinding
 *    defence, because an attacker's page can point its own hostname at
 *    127.0.0.1 and would then send *its* authority, not ours.
 * 2. **Origin**, when present, has to be this service's own origin. An absent
 *    one is the page's normal case, not a refusal: a top-level navigation and
 *    every `<script>`, `<img>` and same-origin `fetch` GET send no `Origin` at
 *    all, so requiring one would refuse the Console itself.
 * 3. **Token** has to be the one this start generated. It is the only defence
 *    a `no-cors` GET or a markup subresource leaves, so it is required on
 *    every request, assets included — which is why `sendPage` rewrites the
 *    built page's asset URLs to carry it.
 */
function isAuthorized(req: http.IncomingMessage, url: URL, port: number, token: string): boolean {
  const host = (req.headers.host ?? '').toLowerCase()
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false

  const origin = req.headers.origin
  if (
    origin !== undefined &&
    origin !== `http://127.0.0.1:${port}` &&
    origin !== `http://localhost:${port}`
  ) {
    return false
  }

  return secretMatches(url.searchParams.get('token') ?? '', token)
}

/**
 * Constant-time comparison with this start's token. `timingSafeEqual` throws on
 * a length mismatch, so the lengths are compared first — a token's length is
 * not the secret worth keeping.
 */
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Serve `dist/index.html` with the token appended to every asset URL Vite
 * emitted.
 *
 * Why the rewrite: the guard requires the token on every request, and a
 * `<script>` or `<link>` cannot attach a query string of its own. So the
 * Console opens `http://127.0.0.1:<port>/?token=<t>`, the service puts the
 * same token on `./assets/index-<hash>.js` and `./assets/index-<hash>.css` on
 * the way out, and the page reads the token from its own URL and appends it to
 * every `fetch` it makes. That is the whole mechanism: no cookie, nothing
 * persisted, and no route prefix — the API routes stay exactly as the spec
 * lists them.
 */
function sendPage(res: http.ServerResponse, distDir: string, token: string): void {
  let html: string
  try {
    html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')
  } catch {
    sendJson(res, 404, { error: 'the page has not been built' })
    return
  }

  const body = html.replace(
    /(src|href)="\.\/(assets\/[^"]+)"/g,
    (_match, attribute: string, assetPath: string) =>
      `${attribute}="./${assetPath}?token=${encodeURIComponent(token)}"`,
  )

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(body)
}

/** Serve one built asset from `dist/assets`, refusing anything outside it. */
function sendAsset(res: http.ServerResponse, distDir: string, pathname: string): void {
  const assetsDir = path.join(distDir, 'assets')
  let name: string
  try {
    name = decodeURIComponent(pathname.slice(ASSET_PREFIX.length))
  } catch {
    sendJson(res, 404, { error: 'not found' })
    return
  }

  // Containment, not a name pattern: `new URL` collapses plain `..`, and an
  // encoded `%2e%2e%2f` survives it, so the decoded name is resolved and then
  // checked to still be under `dist/assets`.
  const file = path.resolve(assetsDir, name)
  if (!file.startsWith(assetsDir + path.sep)) {
    sendJson(res, 404, { error: 'not found' })
    return
  }

  let body: Buffer
  try {
    body = fs.readFileSync(file)
  } catch {
    sendJson(res, 404, { error: 'not found' })
    return
  }

  res.writeHead(200, {
    'content-type': CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
    // Vite's asset names carry a content hash, so a year-long cache is honest.
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(payload))
}

async function listenWithFallback(
  server: http.Server,
  preferredPort: number,
): Promise<{ port: number; fellBack: boolean }> {
  try {
    await listenOnce(server, preferredPort)
    return { port: boundPortOf(server), fellBack: false }
  } catch (error) {
    if (!isUnbindable(error)) throw error
    await listenOnce(server, 0)
    return { port: boundPortOf(server), fellBack: true }
  }
}

function listenOnce(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    // Loopback only: there is no `0.0.0.0` form anywhere (spec decision 13).
    server.listen(port, '127.0.0.1')
  })
}

/** `EADDRINUSE` is a busy port; `EACCES` is one we may not bind — both fall back. */
function isUnbindable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const { code } = error
  return code === 'EADDRINUSE' || code === 'EACCES'
}

function boundPortOf(server: http.Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') return 0
  return address.port
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // Keep-alive connections would otherwise hold `close()` open.
    server.closeAllConnections()
    server.close(error => (error === undefined ? resolve() : reject(error)))
  })
}
