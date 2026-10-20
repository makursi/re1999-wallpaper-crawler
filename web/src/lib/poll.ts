// ── Whether the page should keep asking ─────────────────────────────
//
// The one timing decision the page makes, kept out of the status store as a
// pure function: given what the service last said about the Run, is another
// read worth making? A Run in flight is the only yes — an idle Console costs
// nothing while a tab is open, and an Orphaned Run changes only when a person
// acts on it, so the panel's own refresh after the cleanup is what reports it.

import type { ConsoleRunState } from '../../api-types.js'

/**
 * `true` only while a Run is in flight.
 *
 * `null` is "nothing has been read yet", which is not a reason to poll: the
 * first read is the read that finds out.
 */
export function shouldPoll(state: ConsoleRunState | null | undefined): boolean {
  return state === 'running'
}
