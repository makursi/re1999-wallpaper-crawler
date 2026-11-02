// ── The Console's HTTP surface ──────────────────────────────────────
//
// One port serves the built page and the API (spec decision 14), bound to
// loopback only. Every request — the page, its assets and the API alike — is
// checked against this start's token and the authority the service bound
// (spec decision 13), because a page the owner happens to be visiting must not
// be able to start a Run on their machine.
//
// **What the router owns, and what it does not.** Method-and-path dispatch and
// URL parsing are a library's job, and `@hono/node-server` runs a standard
// `Request`→`Response` app on Node's `http` server. Everything else is ours and
// stays ours: the token / `Host` / `Origin` guard (`http/guard.ts`, one
// middleware above every route), the built page's markup and its stylesheet's
// `url()` rewrites (`http/token-rewrite.ts`, which no static-file helper can do
// — it maps a path to bytes and streams them), the four response shapes
// (`http/respond.ts`, because the page's tests assert exact header strings that
// a framework's defaults would rewrite), and the port fallback below.
//
// Nothing here decides what a status code means. Each route module gathers
// inputs and hands them to the module that decides — `status.ts`,
// `gallery-view.ts`, `run-control.ts` — and the response is built from that
// decision. A reader auditing "does the transport make decisions?" reads
// `routes/` and finds none.
//
// Everything the server needs arrives by injection (spec decision 29): the
// configuration value and the readers. `web/server/console.ts` is the only place
// that reads `core/config.ts`, which is what keeps `tests/**` free of a `.env`.

import { createAdaptorServer } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { Hono } from 'hono'

import type { ConsoleConfig } from './console-config.js'
import type { ConsoleServerDeps, ConsoleService, ServiceRuntime } from './http/deps.js'
import { authGuard } from './http/guard.js'
import { json } from './http/respond.js'
import { FALLBACK_ATTEMPTS, PortUnavailableError, isUsablePort } from './port-usable.js'
import { registerExitRoute } from './routes/exit.js'
import { registerGalleryRoute } from './routes/gallery.js'
import { registerImageRoutes } from './routes/images.js'
import { registerInstanceRoute } from './routes/instance.js'
import { registerRunRoutes } from './routes/run.js'
import { registerStaticRoutes } from './routes/static.js'
import { registerStatusRoute } from './routes/status.js'

// The contract keeps its address: tests and the entry point import these from
// `web/server/server.js` exactly as they always have, so moving the transport's
// internals never moves the seam.
export type {
  ConsoleServerDeps,
  ConsoleService,
  ExitProgram,
  ExitResult,
  RunCleaner,
  RunCleanupResult,
  RunStartResult,
  RunStarter,
  ThumbnailSource,
} from './http/deps.js'

/** Loopback only: there is no `0.0.0.0` form anywhere (spec decision 13). */
const BIND_HOST = '127.0.0.1'

/**
 * Bind the service. The preferred port is used only when a browser will open it
 * and it is free; a preferred `0` asks the OS to choose, so that start takes the
 * OS-assigned path and is not a fallback; otherwise an OS-assigned port is used
 * — a page that refuses to start because a port is busy is the worst available
 * failure mode (spec decision 3). The returned port is always one a browser will
 * connect to, never merely the one that was bound or requested.
 */
export async function startConsoleServer(
  config: ConsoleConfig,
  deps: ConsoleServerDeps,
): Promise<ConsoleService> {
  // The guard compares `Host` against the bound port, which is not known until
  // `listen` resolves — so the runtime object is mutable and read per request.
  const runtime: ServiceRuntime = { config, deps, port: 0 }
  const app = createApp(runtime)

  const { server, port, fellBack } = await listenWithFallback(app.fetch, deps.port)
  runtime.port = port
  const origin = `http://${BIND_HOST}:${port}`

  return {
    origin,
    port,
    fellBack,
    url: `${origin}/?token=${encodeURIComponent(deps.token)}`,
    close: () => closeServer(server),
  }
}

/**
 * The application: the guard, then the routes, then the two fallbacks.
 *
 * Registration order is the request order — the guard is above everything, and
 * the not-found handler is the answer for a path no route claimed. A new route
 * is authenticated by construction rather than by remembering to be.
 */
function createApp(runtime: ServiceRuntime): Hono {
  const app = new Hono()

  // A handler that threw before answering is a named 500 — never the
  // framework's own error page, and never a dropped socket.
  app.onError(() => json(500, { error: 'the Console failed to answer' }))

  app.use('*', authGuard(runtime))

  registerStatusRoute(app, runtime)
  // #82: the single-instance handshake's other end — cheap, guarded, and
  // independent of everything the other routes read.
  registerInstanceRoute(app)
  registerGalleryRoute(app, runtime)
  registerImageRoutes(app, runtime)
  registerRunRoutes(app, runtime)
  // #96: the page's exit — the same guard, and the decision in `run-control.ts`.
  registerExitRoute(app, runtime)
  registerStaticRoutes(app, runtime)

  // `{ "error": "not found" }` for every unclaimed path, whatever the method —
  // which is what the surface answered before it had a router, and what the
  // page's tests still assert.
  app.notFound(() => json(404, { error: 'not found' }))

  return app
}

/**
 * Listen on the preferred port, or on an OS-assigned one when the preferred port
 * is unusable or taken. A preferred `0` goes straight to the OS-assigned path
 * and reports `fellBack: false`: the caller asked for the OS's choice, so there
 * is nothing to announce as unavailable.
 *
 * The preferred port is never bound unless a browser would open it, and the port
 * the listener actually bound is checked too — a listener that rewrites the port
 * is still not an address the JSDoc above promises. Every OS-assigned answer is
 * checked the same way, and one that fails is closed before the next attempt — a
 * bound server that is merely abandoned would leak its handle. A close that
 * fails does not make the port usable, so it does not abort the search either.
 * Running out of attempts is `PortUnavailableError` (`port-usable.ts`), never a
 * port nobody can reach.
 *
 * `createAdaptorServer` rather than `serve`: the listen / error / listening
 * dance is the one place `EADDRINUSE` and `EACCES` have to be told apart from a
 * real failure, and this shape keeps that decision readable.
 */
async function listenWithFallback(
  fetch: Hono['fetch'],
  preferredPort: number,
): Promise<{ server: ServerType; port: number; fellBack: boolean }> {
  // `0` is a supported intent, not an unusable preference: the caller asked the
  // OS to choose, so the OS-assigned path is the answer and nothing is reported
  // as a fallback.
  const asksTheOs = preferredPort === 0
  let lastBindError: unknown = undefined

  if (!asksTheOs && isUsablePort(preferredPort)) {
    try {
      const server = await listenOnce(fetch, preferredPort)
      const port = boundPortOf(server)
      if (isUsablePort(port)) return { server, port, fellBack: false }
      // The listener bound an address the predicate refuses — a future adapter
      // that rewrites the port, say. Close it and let the OS-assigned path
      // answer instead of returning an address no page can open.
      await closeQuietly(server)
    } catch (error) {
      if (!isUnbindable(error)) throw error
      lastBindError = error
    }
  }

  for (let attempt = 0; attempt < FALLBACK_ATTEMPTS; attempt += 1) {
    let server: ServerType
    try {
      server = await listenOnce(fetch, 0)
    } catch (error) {
      if (!isUnbindable(error)) throw error
      lastBindError = error
      continue
    }

    const port = boundPortOf(server)
    if (isUsablePort(port)) return { server, port, fellBack: !asksTheOs }
    // A blocked port is a successful bind and an unusable address: close it
    // before asking again, so nothing is left listening.
    await closeQuietly(server)
  }

  throw new PortUnavailableError(preferredPort, lastBindError)
}

function listenOnce(fetch: Hono['fetch'], port: number): Promise<ServerType> {
  // The adapter's `hostname` option is real but undocumented — it exists only in
  // the package's type declarations — so it is named here once rather than
  // spread through the module. The adapter's `fetch` takes the Node bindings as
  // a second argument; Hono's does not, so this hands it the request alone.
  const server = createAdaptorServer({
    fetch: request => fetch(request),
    hostname: BIND_HOST,
  })

  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      server.close()
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve(server)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, BIND_HOST)
  })
}

/** `EADDRINUSE` is a busy port; `EACCES` is one we may not bind — both fall back. */
function isUnbindable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const { code } = error
  return code === 'EADDRINUSE' || code === 'EACCES'
}

function boundPortOf(server: ServerType): number {
  const address = server.address()
  if (address === null || typeof address === 'string') return 0
  return address.port
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    // Keep-alive connections would otherwise hold `close()` open. The adapter's
    // type is the union of the HTTP/1 and HTTP/2 servers it can build, and only
    // the HTTP/1 one — the one this service asks for — has `closeAllConnections`.
    if ('closeAllConnections' in server) server.closeAllConnections()
    server.close(error => (error === undefined ? resolve() : reject(error)))
  })
}

/**
 * Close a listener whose port was refused. A handle that will not close is still
 * not a usable port, so the close error is swallowed: the search keeps counting
 * attempts and exhaustion reports the refusal, never a leaked-handle failure.
 */
async function closeQuietly(server: ServerType): Promise<void> {
  try {
    await closeServer(server)
  } catch {
    // Deliberately swallowed — see above.
  }
}
