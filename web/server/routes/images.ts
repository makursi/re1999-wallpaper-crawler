// ── GET /api/thumbnail/<name> and GET /api/image/<name> (#35) ───────
//
// Two routes, one module, because they share the whole of their safety: the name
// comes from the URL, `resolveMirrorFile` is what turns it into a path (or a
// refusal), and that resolution — not the image library — is what the 404/500
// boundary is made of. A well-formed name that is not in the Mirror is a missing
// file; only a name that resolved can fail to render.
//
// The path is normalized the way the surface always normalized it: `new URL`
// collapses plain `..` segments, so `/api/thumbnail/..` is not a name at all —
// it arrives as some other path, and the route refuses to serve it. Encoded
// segments survive that normalization and are the resolver's business.

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Context, Hono } from 'hono'

import { IMAGE_CONTENT_TYPES } from '../http/assets.js'
import type { ServiceRuntime } from '../http/deps.js'
import { expectMethod } from '../http/method.js'
import { image, json } from '../http/respond.js'
import { MIRROR_REFUSALS, resolveMirrorFile } from '../mirror-files.js'

const THUMBNAIL_ROUTE = '/api/thumbnail'
const IMAGE_ROUTE = '/api/image'

export function registerImageRoutes(app: Hono, runtime: ServiceRuntime): void {
  for (const [route, isThumbnail] of [
    [THUMBNAIL_ROUTE, true],
    [IMAGE_ROUTE, false],
  ] as const) {
    const handler = (c: Context) => serveImage(c, runtime, route, isThumbnail)
    // Both the exact route and the name-carrying form: `/api/thumbnail` with no
    // name is an empty name, which the resolver refuses — the route does not
    // need its own case for it.
    // `all`, not `get`: the method rule has to answer a wrong method with a 405
    // and its `allow` header, and a router that only registers GET hands a POST
    // to the not-found handler instead.
    app.all(route, expectMethod('GET'), handler)
    app.all(`${route}/*`, expectMethod('GET'), handler)
  }
}

async function serveImage(
  c: Context,
  runtime: ServiceRuntime,
  route: string,
  isThumbnail: boolean,
): Promise<Response> {
  const { config, deps } = runtime
  const pathname = new URL(c.req.raw.url).pathname
  const prefix = `${route}/`
  // A path that normalized into something else entirely — `/api/thumbnail/..`
  // collapses to `/api/` — is not this route's to answer.
  if (pathname !== route && !pathname.startsWith(prefix)) {
    return json(404, { error: 'not found' })
  }
  const name = pathname.length <= prefix.length ? '' : pathname.slice(prefix.length)

  const resolved = resolveMirrorFile(config.imagesDir, name)
  if (!resolved.ok) {
    // A malformed name and a name that is merely not there are different
    // answers: 400 says the request was wrong, 404 says the Wallpaper is not in
    // the Mirror. The invalid-name message never carries a path.
    return resolved.reason === MIRROR_REFUSALS.notListed
      ? json(404, { error: 'missing file' })
      : json(400, { error: 'invalid name' })
  }

  const extension = path.extname(resolved.path).toLowerCase()
  const contentType = IMAGE_CONTENT_TYPES[extension] ?? 'application/octet-stream'
  if (!isThumbnail) return image(fs.readFileSync(resolved.path), contentType)

  if (deps.thumbnailSource === undefined) {
    // A service that cannot render (a broken native binary surfaces as a
    // rejected dynamic import at this very call site) answers a named 500; the
    // route survives and the next request retries.
    return json(500, { error: 'thumbnail failed' })
  }
  try {
    const bytes = await deps.thumbnailSource.thumbnail(path.basename(resolved.path), resolved.path)
    return image(bytes, contentType)
  } catch {
    return json(500, { error: 'thumbnail failed' })
  }
}
