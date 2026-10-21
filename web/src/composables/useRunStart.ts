// ── The page's one Run start ────────────────────────────────────────
//
// Two places offer the one action that downloads wallpapers — the empty wall's
// band (#83) and the Run panel — and they have to be one action, not two: a
// per-component `starting` flag would let one button re-arm while the other's
// request is still in flight, and a Run start is not a request to send twice.
// The state is module-scoped like the status store: the page has one of these,
// and the wall and the drawer read the same answer.
//
// Nothing here starts a Run on its own. The only caller is a click: the first
// fetch is gigabytes and many minutes, and that decision belongs to the reader
// (ADR 0016 — the page still has no stop control; closing the window is the
// stop).

import type { ComputedRef, Ref } from 'vue'
import { computed, ref } from 'vue'

import type { ConsoleRunStartPayload } from '../../api-types.js'
import type { RefusalView } from '../i18n/refusal'
import { refusalFromError, refusalOf, refusalTextOf } from '../i18n/refusal'
import { postJson } from '../lib/console-api.js'
import { useConsoleStatus } from './useConsoleStatus.js'

/** Whether a start is in flight, and the one sentence a refusal reads as. */
export interface RunStartStore {
  /** `true` from the click until the service has answered. */
  starting: Ref<boolean>
  /** The last start's refusal in the reader's language; `null` when none. */
  refusalText: ComputedRef<string | null>
  /** Ask the service for a Run. The page's only path to a start. */
  start: () => Promise<void>
}

const starting = ref(false)
const refusal = ref<RefusalView | null>(null)

/** The refusal as one sentence; the dictionary owns the words (#47). */
const refusalText = computed(() => refusalTextOf(refusal.value, 'run.refusedStart'))

/**
 * Start a Run, then read the status back rather than assuming it: the Run's
 * identity is its log, and a refused start leaves the page where it was.
 */
async function start(): Promise<void> {
  if (starting.value) return
  const { refresh } = useConsoleStatus()
  starting.value = true
  refusal.value = null
  try {
    const reply = await postJson<ConsoleRunStartPayload>('/api/run')
    if (!reply.ok || !reply.body.started) {
      // The service sends a code and its parameters; the sentence is the
      // dictionary's, in the reader's language (#47). A body without one is an
      // HTTP refusal (the guard's 403), named by its status instead.
      refusal.value = refusalOf(reply.status, reply.body.refusal)
      return
    }
    await refresh()
  } catch (error) {
    // A transport failure is a runtime message, not copy (docs/adr/0014); the
    // page says it as one plain sentence (see `refusalTextOf`).
    refusal.value = refusalFromError(error)
  } finally {
    starting.value = false
  }
}

export function useRunStart(): RunStartStore {
  return { starting, refusalText, start }
}
