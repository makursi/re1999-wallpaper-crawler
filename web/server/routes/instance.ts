// ── GET /api/instance ───────────────────────────────────────────────
//
// The Console's own liveness answer, and nothing else (#82). A later start reads
// the running Console's record and asks this route whether the program that
// wrote it still answers; the token guard above every route is what makes a 200
// proof of identity rather than a guess about the port.
//
// It answers a fixed marker instead of a status payload on purpose: the
// handshake must not depend on the Mirror, the Run logs, the Gallery list or the
// network, or a probe could time out on a busy service and start a second one.
// `web/server/instance-handshake.ts` is the other end of this contract.

import type { Hono } from 'hono'

import { expectMethod } from '../http/method.js'
import { json } from '../http/respond.js'

/** The path the handshake probes. Owned here, next to the route that answers it. */
export const INSTANCE_PROBE_PATH = '/api/instance'

export function registerInstanceRoute(app: Hono): void {
  app.all(INSTANCE_PROBE_PATH, expectMethod('GET'), () => json(200, { ok: true }))
}
