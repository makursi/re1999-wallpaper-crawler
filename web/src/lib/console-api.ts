// ── The page's one HTTP client ──────────────────────────────────────
//
// Every request the page makes goes through this module, for two reasons that
// are the same reason: the token is appended in exactly one place, and a
// non-2xx answer stops being three different behaviours in three components.
//
// The token itself belongs to `console-token.ts` — this module only knows how
// it rides on a request. The service wants it on every request, assets
// included (`web/server/server.ts` › `isAuthorized`), which is why the built
// page's asset URLs are rewritten with it on the way out.

import { consoleToken } from '../console-token.js'

/**
 * What one request answered.
 *
 * The status and the body are both handed back, `ok` or not, because the two
 * non-2xx answers the page meets are different questions: a refusal carries a
 * code and its parameters (the start's `409`/`412`), while a failure carries
 * nothing the page can act on. Collapsing both into an exception would lose
 * the code the refusal needs.
 */
export interface ConsoleReply<T> {
  status: number
  ok: boolean
  body: T
}

/**
 * Put this start's token on a path, as the query string the guard reads.
 *
 * `?` when the path has no query, `&` when it already has one, and no query at
 * all when there is no token — an empty token is refused by the guard either
 * way, and `?token=` would only make a failed request look deliberate.
 */
export function withToken(path: string, token: string): string {
  if (token === '') return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}token=${encodeURIComponent(token)}`
}

async function requestJson<T>(method: 'GET' | 'POST', path: string): Promise<ConsoleReply<T>> {
  const response = await fetch(withToken(path, consoleToken()), { method })
  // The body is the service's own contract (`web/api-types.ts`), so it is
  // asserted rather than validated: both sides of this request are this
  // repository's code, and a validator here would be a second statement of the
  // same shape. Held as `unknown` first, so the assertion is the only unsound
  // step and it is visible as one.
  const payload: unknown = await response.json()
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both sides are this repository's code, and the shape has one home (`web/api-types.ts`); a validator here would be a second statement of it.
  return { status: response.status, ok: response.ok, body: payload as T }
}

/** Read one of the service's JSON routes. */
export function getJson<T>(path: string): Promise<ConsoleReply<T>> {
  return requestJson<T>('GET', path)
}

/** Ask the service to do something; the answer is whether it did. */
export function postJson<T>(path: string): Promise<ConsoleReply<T>> {
  return requestJson<T>('POST', path)
}
