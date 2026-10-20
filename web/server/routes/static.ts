// ── The page and its assets ─────────────────────────────────────────
//
// One port serves the built page and the API (spec decision 14), bound to
// loopback only. The page's markup and its stylesheet are both rewritten on the
// way out to carry this start's token — see `token-rewrite.ts` for why the
// stylesheet's `url()` references cannot inherit the stylesheet's own query
// string.
//
// Neither route uses the method rule: a non-GET request to the page or an asset
// is an unknown route here, and the honest answer to it is the 404 every unknown
// path gets — same as before this surface had a router.

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Hono } from 'hono'

import { ASSET_PREFIX, assetResponse } from '../http/assets.js'
import type { ServiceRuntime } from '../http/deps.js'
import { json, page } from '../http/respond.js'
import { rewritePageMarkup } from '../http/token-rewrite.js'

export function registerStaticRoutes(app: Hono, runtime: ServiceRuntime): void {
  const servePage = (): Response => pageResponse(runtime)

  app.get('/', servePage)
  app.get('/index.html', servePage)

  app.get(`${ASSET_PREFIX}*`, c =>
    // The path is normalized the way the surface always normalized it; the
    // containment check inside `assetResponse` is what refuses the rest.
    assetResponse(runtime.config.distDir, new URL(c.req.raw.url).pathname, runtime.deps.token),
  )
}

/**
 * The built page's `index.html`, with the token on every asset URL Vite emitted.
 *
 * Read per request rather than cached: the file is one small document, and a
 * service started before a rebuild must not keep serving the old one.
 */
function pageResponse(runtime: ServiceRuntime): Response {
  let html: string
  try {
    html = fs.readFileSync(path.join(runtime.config.distDir, 'index.html'), 'utf8')
  } catch {
    return json(404, { error: 'the page has not been built' })
  }
  return page(rewritePageMarkup(html, runtime.deps.token))
}
