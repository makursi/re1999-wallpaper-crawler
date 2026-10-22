// ── The page's one exit (#96) ───────────────────────────────────────
//
// The page's way out of the program. Module-scoped like the status store: the
// navigation's Exit is the only caller today, and a per-component flag would let
// a second copy of the page believe the first request never happened.
//
// The confirmation rule is the service's, not the page's (#96): the first click
// asks `POST /api/exit` without consent — idle, the service stops; a Run in
// flight, it answers `409 exit-confirm-required`. Only that refusal opens the
// page's small confirm, and only the reader's answer sends `confirm: true`. The
// page therefore never decides when to ask, which is what keeps the terminal
// signal and the Exit on one predicate (`stopDecision`, ADR 0022).
//
// After a `202`, the status poll is halted and this store is the page's
// "exited" state: the service is closing, so every further read would only paint
// a connection failure over the notice.

import type { ComputedRef, Ref } from 'vue'
import { computed, ref } from 'vue'

import type { ConsoleExitPayload } from '../../api-types.js'
import type { RefusalView } from '../i18n/refusal'
import { refusalFromError, refusalOf, refusalTextOf } from '../i18n/refusal'
import { postJson } from '../lib/console-api.js'
import { useConsoleStatus } from './useConsoleStatus.js'

/** Where the exit is: idle, asking the service, asking the reader, or gone. */
export interface PageExitStore {
  /** `true` from the click until the service has answered. */
  exiting: Ref<boolean>
  /** `true` while the page is waiting for the reader's confirmation. */
  awaitingConfirmation: Ref<boolean>
  /** `true` once the service accepted the exit; the page shows the notice. */
  exited: Ref<boolean>
  /**
   * `true` when the exit being performed is one the service refused for a Run in
   * flight — the confirmed exit, or the unconfirmed attempt that met the `409`.
   * The notice uses it to say the Run's log may stop short, the fact the reader
   * needs on the next start. It describes the exit that is actually happening:
   * a new attempt and "keep running" both clear it.
   */
  interruptedRun: Ref<boolean>
  /** The last exit's refusal in the reader's language; `null` when none. */
  refusalText: ComputedRef<string | null>
  /** Ask to exit. The page's only path to stopping the program. */
  exit: () => Promise<void>
  /** The reader's yes: the one request that carries `confirm: true`. */
  confirm: () => Promise<void>
  /** Dismiss the confirmation; nothing is sent and the program keeps running. */
  cancel: () => void
}

const exiting = ref(false)
const awaitingConfirmation = ref(false)
const exited = ref(false)
const interruptedRun = ref(false)
const refusal = ref<RefusalView | null>(null)

/** The refusal as one sentence; the dictionary owns the words (#47). */
const refusalText = computed(() => refusalTextOf(refusal.value, 'exit.failed'))

/**
 * One exit request. `confirmed` is the reader's answer, never the page's guess:
 * the service only lets a Run in flight go when this is `true`.
 */
async function request(confirmed: boolean): Promise<void> {
  if (exiting.value || exited.value) return
  exiting.value = true
  refusal.value = null
  // A new request supersedes the previous exit's story. A confirmed one is the
  // exception: the `409` it is answering already proved a Run was in flight, so
  // its notice must still say the log may be truncated.
  interruptedRun.value = confirmed
  try {
    const reply = await postJson<ConsoleExitPayload>('/api/exit', { confirm: confirmed })
    if (reply.ok && reply.body.exiting) {
      exited.value = true
      // The service is closing: the poll must not add a failure line to the
      // notice, and a reader who waits must not see a red panel.
      useConsoleStatus().halt()
      return
    }
    // The service's one confirmation rule, as an answer: it refused because a
    // Run is in flight. The page asks now, and owns the wording.
    if (
      !confirmed &&
      reply.status === 409 &&
      reply.body.refusal?.code === 'exit-confirm-required'
    ) {
      interruptedRun.value = true
      awaitingConfirmation.value = true
      return
    }
    // Anything else is a refusal the page can only report: the guard's 403, or
    // a code this build does not know.
    refusal.value = refusalOf(reply.status, reply.body.refusal ?? null)
  } catch (error) {
    // A transport failure is a runtime message, not copy (docs/adr/0014); the
    // sentence beside it is the dictionary's (`refusalTextOf`).
    refusal.value = refusalFromError(error)
  } finally {
    exiting.value = false
  }
}

/** The first click: no consent yet, so the service decides whether to ask. */
function exit(): Promise<void> {
  return request(false)
}

/** The reader's yes in the page: the one request that may kill a Run's tree. */
function confirm(): Promise<void> {
  awaitingConfirmation.value = false
  return request(true)
}

/** The reader said no: the dialog closes, nothing is sent, nothing stops. */
function cancel(): void {
  awaitingConfirmation.value = false
  // Nothing was interrupted either: the claim belongs to an exit that did not
  // happen, and a later idle exit must not inherit it.
  interruptedRun.value = false
}

export function usePageExit(): PageExitStore {
  return {
    exiting,
    awaitingConfirmation,
    exited,
    interruptedRun,
    refusalText,
    exit,
    confirm,
    cancel,
  }
}
