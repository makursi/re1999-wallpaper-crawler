// ── The service's four answers ──────────────────────────────────────
//
// Every response the Console sends is built here, by hand, and that is the
// point: the page's tests assert exact header strings (`application/json;
// charset=utf-8`, the year-long immutable cache, `nosniff`), and a framework's
// default serialisation writes its own variants of those. A library may decide
// which handler runs; it does not get to decide what the page is told.
//
// The four shapes are exactly the four the surface has: JSON, image bytes, the
// built page, and one built asset. Nothing here decides a status code from a
// domain state — that is the route's job, and the route is where the judgement
// lives.

/** The service's JSON answer: no-store, and the charset the page expects. */
export function json(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

/**
 * One image: its own bytes, its own type, and `nosniff` so a browser cannot
 * decide the type for itself. A year-long cache is honest on both image routes —
 * a Wallpaper's name embeds a content hash, and so does the thumbnail derived
 * from it.
 */
export function image(bytes: Uint8Array, contentType: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}

/**
 * The built page, rewritten to carry this start's token on its asset URLs (the
 * caller does the rewriting). `no-cache` because the page is the one document
 * that has to be re-read: it names hashed assets, and a stale copy would point
 * at a bundle that no longer exists.
 */
export function page(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
    },
  })
}

/**
 * One built asset. Vite's asset names carry a content hash, so a year-long cache
 * is honest; `nosniff` for the same reason the image routes carry it.
 */
export function asset(bytes: Uint8Array, contentType: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}
