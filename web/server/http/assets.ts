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

import { IMAGE_EXTENSIONS } from '../../../core/wallpaper-url.js'
import { asset, json } from './respond.js'
import { rewriteStylesheet } from './token-rewrite.js'

/** Where the built page's hashed assets live, relative to the page's origin. */
export const ASSET_PREFIX = '/assets/'

/** What a served file's extension means over HTTP. */
export const CONTENT_TYPES: Record<string, string> = {
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
 * The image routes' answer, for exactly the extensions a Wallpaper can have
 * (`IMAGE_EXTENSIONS`, core/wallpaper-url.ts): derived from `CONTENT_TYPES` so
 * the two tables cannot disagree about what a `.jpg` is, and from the Wallpaper
 * URL set's own list so the routes serve what the pipeline downloads.
 */
export const IMAGE_CONTENT_TYPES: Record<string, string> = Object.fromEntries(
  IMAGE_EXTENSIONS.map(extension => [extension, CONTENT_TYPES[extension]]),
)

/** The type one built asset is served as; anything unknown is opaque bytes. */
export function contentTypeOf(name: string): string {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
}

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
