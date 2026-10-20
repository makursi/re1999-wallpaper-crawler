// ── POST /api/run and POST /api/run/cleanup (#34, #36) ──────────────
//
// The answer is only whether the start was accepted, and why it was refused: a
// Run's identity is its Run log, never this handle, so the next `/api/status`
// reports it from the log directory and a Run started from a terminal looks
// identical (spec decision 7).
//
// The refusals are the two the page can act on — 409 for a Run already in
// flight, 412 with the missing prerequisite's name — and the starter decides
// which (`run-control.ts`). This module turns that decision into HTTP; it makes
// none of its own.
//
// The cleanup route is the one route this ticket's spec adds, and added on
// purpose: an Orphaned Run is a first-class state (ADR 0009), so the page that
// reports it has to be able to clear it. The cleanup does two things and no
// more — closes the leftover Browser session and acknowledges the log's claim in
// memory. It never deletes or rewrites a Run log: the log is the audit trail
// (ADR 0007) and the Console does not own it, so cleaning up removes the claim
// that a Run may still be writing, not the record that it ran.

import type { Hono } from 'hono'

import type { ConsoleRunCleanupPayload, ConsoleRunStartPayload } from '../../api-types.js'
import type { ServiceRuntime } from '../http/deps.js'
import { expectMethod } from '../http/method.js'
import { json } from '../http/respond.js'

export function registerRunRoutes(app: Hono, runtime: ServiceRuntime): void {
  const { deps } = runtime

  app.all('/api/run', expectMethod('POST'), async () => {
    const result = await deps.startRun()
    const payload: ConsoleRunStartPayload = { started: result.started, refusal: result.refusal }
    return json(result.status ?? (result.started ? 202 : 409), payload)
  })

  app.all('/api/run/cleanup', expectMethod('POST'), async () => {
    const cleaner = deps.cleanupRun
    // A service without Run control has no cleanup to offer, and the honest
    // answer to that route is 404 — not a no-op that claims it cleaned a Run.
    if (cleaner === undefined) return json(404, { error: 'not found' })
    const cleaned = await cleaner()
    const payload: ConsoleRunCleanupPayload = {
      cleaned: cleaned.cleaned,
      refusal: cleaned.refusal,
    }
    return json(cleaned.status ?? (cleaned.cleaned ? 200 : 409), payload)
  })
}
