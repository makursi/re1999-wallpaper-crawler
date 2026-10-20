// ── What a file's extension means over HTTP ─────────────────────────
//
// The one table both the built assets and the image routes read, so a `.jpg`
// cannot mean two different things depending on which route served it. The image
// routes' half is derived from this table *and* from the Wallpaper URL set's own
// extension list (`core/wallpaper-url.ts`), which is what keeps "what the route
// serves" equal to "what the pipeline downloads".

import * as path from 'node:path'

import { IMAGE_EXTENSIONS } from '../../../core/wallpaper-url.js'

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
 * The image routes' answer, for exactly the extensions a Wallpaper can have.
 *
 * Derived from `CONTENT_TYPES` so the two tables cannot disagree about what a
 * `.jpg` is, and from the Wallpaper URL set's own list so the routes serve what
 * the pipeline downloads.
 */
export const IMAGE_CONTENT_TYPES: Record<string, string> = Object.fromEntries(
  IMAGE_EXTENSIONS.map(extension => [extension, CONTENT_TYPES[extension]]),
)

/** The type one built asset is served as; anything unknown is opaque bytes. */
export function contentTypeOf(name: string): string {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
}

/** The type one Wallpaper is served as, from the image routes' own subset. */
export function imageContentTypeOf(name: string): string {
  return IMAGE_CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
}
