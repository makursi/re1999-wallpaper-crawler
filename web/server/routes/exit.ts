// ── POST /api/exit (#96) ────────────────────────────────────────────
//
// The page's one way out: stop the local service, end the program (#96). The
// route is deliberately thin — it reads the caller's `confirm`, asks the exit
// controller, and writes its answer with the status the controller named. It
// makes no decision of its own and prints nothing: the Chinese lines and
// `process.exit(0)` belong to the composition root (`web/server/console.ts`),
// and the tree kill belongs to the controller (`web/server/run-control.ts`).
//
// A service given no `exitProgram` answers `404`, not a no-op that claims it
// would stop: a status-only service has no process of its own to end.
//
// The controller schedules the shutdown on a short timer, so this route's `202`
// is written and flushed before the service begins to close — the page's last
// request must not be a dropped connection.

import type { Context, Hono } from 'hono'

import type { ConsoleExitPayload } from '../../api-types.js'
import type { ServiceRuntime } from '../http/deps.js'
import { expectMethod } from '../http/method.js'
import { json } from '../http/respond.js'
import { exitStatusOf } from '../run-control.js'

/** The one flag the page sends: its answer to the confirmation question. */
async function confirmedOf(c: Context): Promise<boolean> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    // No body, or not JSON: the safe reading is "not confirmed". An idle exit
    // still goes ahead; an exit with a Run in flight is refused.
    return false
  }
  if (typeof body !== 'object' || body === null || !('confirm' in body)) return false
  // Only the literal `true` is consent; anything else must not kill a Run.
  return body.confirm === true
}

export function registerExitRoute(app: Hono, runtime: ServiceRuntime): void {
  app.all('/api/exit', expectMethod('POST'), async c => {
    const exitProgram = runtime.deps.exitProgram
    // A service without an exit action has none to offer; `404` is the shape the
    // run routes' absent cleaner uses for the same reason.
    if (exitProgram === undefined) return json(404, { error: 'not found' })

    const result = exitProgram(await confirmedOf(c))
    // The accepted body is exactly `{"exiting": true}` (spec #93): a permitted
    // exit has no refusal to explain, so the field is absent rather than
    // `null`. The `409` still carries its code.
    const payload: ConsoleExitPayload = { exiting: result.exiting }
    if (result.refusal !== undefined) payload.refusal = result.refusal
    // The status comes from the controller, which owns the decision; the route
    // only relays it.
    return json(exitStatusOf(result), payload)
  })
}
