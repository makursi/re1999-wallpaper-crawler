// ── A refusal, in the reader's language ─────────────────────────────
//
// The service emits a refusal as `{ code, missing }` and never as a sentence
// (#47, docs/adr/0014): the page is the process that knows which language the
// reader chose. This is the page's one place that turns a code into words —
// the refusal's copy and, for `missing-prerequisite`, the prerequisite names
// both come from the dictionary, so switching the language re-words a refusal
// that is already on screen.

import type { ConsoleRefusal } from '../../api-types.js'
import { t } from './locale'
import type { MessageKey } from './messages'
import { PREREQUISITE_MESSAGE_KEYS, REFUSAL_MESSAGE_KEYS } from './messages'

/** One refusal, said in the locale currently in force. */
export function describeRefusal(refusal: ConsoleRefusal): string {
  const key = REFUSAL_MESSAGE_KEYS[refusal.code]
  if (refusal.code !== 'missing-prerequisite') return t(key)
  const missing = refusal.missing
    .map(code => t(PREREQUISITE_MESSAGE_KEYS[code]))
    .join(t('run.causeSeparator'))
  return t(key, { missing })
}

/**
 * The three shapes a refusal is met in: the service's own code plus parameters
 * (#47), an HTTP refusal whose body carried no code (the request guard's 403),
 * and a transport error, which is a runtime message rather than copy
 * (docs/adr/0014). Both panels show refusals, so the shape and the sentence it
 * reads as live here once rather than once per panel.
 */
export type RefusalView =
  | { kind: 'code'; refusal: ConsoleRefusal }
  | { kind: 'status'; status: number }
  | { kind: 'error'; message: string }

/** The refusal a request's answer carries: the code it sent, or its HTTP status. */
export function refusalOf(status: number, code: ConsoleRefusal | null): RefusalView {
  return code != null ? { kind: 'code', refusal: code } : { kind: 'status', status }
}

/** The refusal a thrown request carries: the transport's own message, not copy. */
export function refusalFromError(error: unknown): RefusalView {
  return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
}

/**
 * The refusal as one sentence; `null` when there is none to show. `refusedKey`
 * is the panel's own message for an HTTP refusal, because a start and a cleanup
 * are refused by different sentences.
 *
 * A transport failure is the page's own sentence too (#83): the thrown text —
 * `Failed to fetch`, a socket error — is a runtime message, not copy (ADR 0014),
 * and printing it at a player is exactly the "stack instead of words" the
 * first-run ticket forbids. The retry beside the sentence is the affordance.
 */
export function refusalTextOf(view: RefusalView | null, refusedKey: MessageKey): string | null {
  if (view === null) return null
  if (view.kind === 'code') return describeRefusal(view.refusal)
  if (view.kind === 'status') return t(refusedKey, { status: view.status })
  return t('error.connection')
}
