// ── The page's one status ───────────────────────────────────────────
//
// One read of `/api/status` for the whole page. The navigation's Mirror count
// and the Run panel's facts are the same fact, so they come from the same
// value: two reads were two snapshots, and a drawer that disagreed with the
// count above it is exactly the bug this store removes.
//
// Module-scoped on purpose — no state library, no injection key. The page has
// one of these; a second instance would be a second answer.
//
// Polling is the store's, not a panel's: a Run in flight is re-read every five
// seconds, and the moment the Run ends the timer stops. Closing the page ends
// it with the document — there is no handle to release.
//
// The read is repeated when the window regains focus (#95): the reader who fixes
// the missing `.env` in an editor and comes back finds the notice gone, with no
// reload. The drawer's own re-read on open is the shell's (`App.vue`), because
// "the drawer opened" is the shell's fact, not this store's.

import type { Ref } from 'vue'
import { ref } from 'vue'

import type { ConsoleStatusPayload } from '../../api-types.js'
import { getJson } from '../lib/console-api.js'
import { shouldPoll } from '../lib/poll.js'

/** How often a Run in flight is re-read. */
const POLL_INTERVAL_MS = 5000

/**
 * The failure the page reports when it has nothing to show.
 *
 * A failed poll leaves the last known view in place and says nothing: the
 * drawer must not turn red because one of twenty reads of a Run that is still
 * running timed out. Only a failure with no status behind it is worth a line,
 * because then there is nothing else to show.
 */
export interface ConsoleStatusStore {
  status: Ref<ConsoleStatusPayload | null>
  failure: Ref<string | null>
  /** Read once, now — the page's own "try again" after an action. */
  refresh: () => Promise<void>
  /**
   * Stop reading for good (#96): after a successful exit there is no service
   * left to answer, and a poll would only paint a connection failure over the
   * "exited" notice. Nothing restarts it in this document — the program is gone.
   */
  halt: () => void
}

const status = ref<ConsoleStatusPayload | null>(null)
const failure = ref<string | null>(null)

/** The poll's handle; `null` when the page is not polling. */
let timer: ReturnType<typeof setInterval> | null = null

/** Whether the first read has been started, so a second consumer does not repeat it. */
let initialised = false

/**
 * Whether the page has stopped reading. Set by `halt` only: a status read after
 * an exit cannot succeed, and the panel must not turn red behind the full-page
 * "exited" notice.
 */
let halted = false

function stopPolling(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

function startPolling(): void {
  if (halted || timer !== null) return
  timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
}

async function refresh(): Promise<void> {
  if (halted) return
  try {
    const reply = await getJson<ConsoleStatusPayload>('/api/status')
    if (halted) return
    if (!reply.ok) {
      if (status.value === null) failure.value = `HTTP ${reply.status}`
      return
    }
    status.value = reply.body
    failure.value = null
    // The state the service just reported decides whether there is a next
    // read: a Run that ended stops the timer on the same tick that shows it.
    if (shouldPoll(reply.body.state)) startPolling()
    else stopPolling()
  } catch (error) {
    if (halted) return
    if (status.value === null) {
      failure.value = error instanceof Error ? error.message : String(error)
    }
  }
}

/** Stop the page's status reads for good, and say so (#96). */
function halt(): void {
  halted = true
  stopPolling()
}

/**
 * Re-read whenever the window regains focus: a `.env` created while the page
 * was open in another window is picked up without a reload (#95). Installed
 * once, with the store's one initial read, so a second consumer does not add a
 * second listener.
 */
function reReadOnFocus(): void {
  window.addEventListener('focus', () => void refresh())
}

/**
 * The page's status, read for the first time by whoever asks first.
 *
 * Called from a component's setup, so the initial read starts with the page and
 * the second caller — the drawer's panel — finds it already under way instead
 * of starting a competing one.
 */
export function useConsoleStatus(): ConsoleStatusStore {
  if (!initialised) {
    initialised = true
    void refresh()
    reReadOnFocus()
  }
  return { status, failure, refresh, halt }
}
