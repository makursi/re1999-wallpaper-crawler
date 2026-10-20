// ── The built page's assets, with two refusals and one rewrite ──────
//
// An asset is one file under `web/dist/assets/`, and this module is the only
// place that turns a request path into one. Two things make it ours rather than
// a static-file helper's:
//
// 1. **Containment, not a name pattern**: `new URL` collapses plain `..`, and an
//    encoded `%2e%2e%2f` survives it, so the decoded name is resolved and then
//    checked to still be under the directory.
// 2. **The token on a stylesheet's `url()` references** — the one transformation
//    no static helper can do, because it maps a path to bytes and streams them.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { contentTypeOf } from './content-types.js'
import { asset, json } from './respond.js'
import { rewriteStylesheet } from './token-rewrite.js'

/** Where the built page's hashed assets live, relative to the page's origin. */
export const ASSET_PREFIX = '/assets/'

/**
 * Serve one built asset from the page's `assets/`, refusing anything outside it.
 *
 * The stylesheet is the one asset that names other assets, and the browser will
 * not lend it its query string — so its `url()` references are handed the token
 * here, on the way out.
 */
export function assetResponse(distDir: string, pathname: string, token: string): Response {
  const assetsDir = path.join(distDir, 'assets')
  let name: string
  try {
    name = decodeURIComponent(pathname.slice(ASSET_PREFIX.length))
  } catch {
    return json(404, { error: 'not found' })
  }

  const file = path.resolve(assetsDir, name)
  if (!file.startsWith(assetsDir + path.sep)) {
    return json(404, { error: 'not found' })
  }

  let body: Buffer
  try {
    body = fs.readFileSync(file)
  } catch {
    return json(404, { error: 'not found' })
  }

  const contentType = contentTypeOf(name)
  const payload = contentType.startsWith('text/css')
    ? Buffer.from(rewriteStylesheet(body.toString('utf8'), token), 'utf8')
    : body

  return asset(payload, contentType)
}
