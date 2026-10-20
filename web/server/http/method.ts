// ── One method rule, stated once ────────────────────────────────────
//
// Every API route answers one method and refuses the others with the same 405
// and the same `allow` header. Written once here because it is transport, not
// policy: five copies in five route files is five chances to drift, and a route
// that forgot the check would answer a write with a read's body.

import type { MiddlewareHandler } from 'hono'

import { json } from './respond.js'

/** Refuse any method but `method`, naming the one the route does answer. */
export function expectMethod(method: 'GET' | 'POST'): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== method) {
      return json(405, { error: 'method not allowed' }, { allow: method })
    }
    // Returning the downstream answer rather than falling through keeps every
    // path of this middleware returning a value, which is what makes the
    // "refuse or continue" shape read as one statement.
    return next()
  }
}
