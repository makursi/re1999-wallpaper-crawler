// ── The request guard (spec decision 13) ────────────────────────────
//
// One middleware, above every route, so a new route is authenticated by
// construction rather than by remembering to be. The three checks are the ones
// this surface has always made, in the same order:
//
// 1. **Host** has to be the authority the service bound — the DNS-rebinding
//    defence, because an attacker's page can point its own hostname at
//    127.0.0.1 and would then send *its* authority, not ours.
// 2. **Origin**, when present, has to be this service's own origin. An absent
//    one is the page's normal case, not a refusal: a top-level navigation and
//    every `<script>`, `<img>` and same-origin `fetch` GET send no `Origin` at
//    all, so requiring one would refuse the Console itself.
// 3. **Token** has to be the one this start generated. It is the only defence
//    a `no-cors` GET or a markup subresource leaves, so it is required on every
//    request, assets included — which is why `token-rewrite.ts` puts it on the
//    built page's asset URLs and on the stylesheet's `url()` references, which
//    a browser does not resolve with the stylesheet's own query string.

import { timingSafeEqual } from 'node:crypto'

import type { MiddlewareHandler } from 'hono'

import type { ServiceRuntime } from './deps.js'
import { json } from './respond.js'

/**
 * Bind the guard to this service. The port is read at request time: it is not
 * known until `listen` has resolved, and the `Host` check is against the port
 * actually bound.
 */
export function authGuard(runtime: ServiceRuntime): MiddlewareHandler {
  return async (c, next) => {
    const { port } = runtime
    // A request cannot arrive before `listen` resolves, but a service whose
    // port stayed 0 has no authority to compare against — say so rather than
    // refuse with a misleading 403.
    if (port === 0) return json(500, { error: 'the Console is not listening' })

    const host = (c.req.header('host') ?? '').toLowerCase()
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return json(403, { error: 'forbidden' })
    }

    const origin = c.req.header('origin')
    if (
      origin !== undefined &&
      origin !== `http://127.0.0.1:${port}` &&
      origin !== `http://localhost:${port}`
    ) {
      return json(403, { error: 'forbidden' })
    }

    if (!secretMatches(c.req.query('token') ?? '', runtime.deps.token)) {
      return json(403, { error: 'forbidden' })
    }

    return next()
  }
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
