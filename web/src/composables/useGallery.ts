// ── The page's one gallery read ─────────────────────────────────────
//
// `/api/gallery` is read once for the whole page: the wall draws its rows from it
// and the Run panel will print the same figures line, so the two must come from
// one snapshot. Two reads were two answers, and a wall showing 1001 tiles beside
// a panel saying 1013 is exactly the bug this store removes (#94).
//
// Module-scoped on purpose — no state library, no injection key. The page has
// one of these; a second caller finds the read already under way, and the one
// `watch` below is registered once.
//
// It is deliberately not polled: the Mirror changes only when a Run writes to it,
// and re-reading the wall under the reader's cursor mid-scroll is a worse answer
// than a stale one until the next reload. The one exception is a Run that stops
// writing (#83): its last files are the wall's new tiles, and the status store
// is the page's clock, so the read follows that transition and nothing else.
//
// The read itself — the token, the error shape — is the client's
// (`lib/console-api.ts`); this composable only owns the page's two values.

import type { Ref } from 'vue'
import { ref, watch } from 'vue'

import type { ConsoleGalleryPayload } from '../../api-types.js'
import { getJson } from '../lib/console-api.js'
import { useConsoleStatus } from './useConsoleStatus'

export interface GalleryStore {
  gallery: Ref<ConsoleGalleryPayload | null>
  failure: Ref<string | null>
  /** Read the wall again. Also the retry a failed read offers (#83). */
  load: () => Promise<void>
}

const gallery = ref<ConsoleGalleryPayload | null>(null)
const failure = ref<string | null>(null)

/** Whether the first read, and the one watch that follows a Run, have started. */
let initialised = false

async function load(): Promise<void> {
  try {
    const reply = await getJson<ConsoleGalleryPayload>('/api/gallery')
    if (!reply.ok) {
      failure.value = `HTTP ${reply.status}`
      return
    }
    gallery.value = reply.body
    failure.value = null
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  }
}

function initialise(): void {
  if (initialised) return
  initialised = true
  void load()

  // The one lifecycle this read follows: a Run in flight becomes a Run that has
  // stopped, and the wall is re-read on the transition (not during the Run —
  // the status's own Mirror count is what the in-flight band shows).
  const { status } = useConsoleStatus()
  watch(
    () => status.value?.state,
    (state, previous) => {
      if (previous === 'running' && state !== 'running') void load()
    },
  )
}

/**
 * The page's gallery, read for the first time by whoever asks first.
 *
 * Called from a component's setup, so the initial read starts with the page and
 * the second caller — the Run panel, once it shows the figures — finds it
 * already under way instead of starting a competing one.
 */
export function useGallery(): GalleryStore {
  initialise()
  return { gallery, failure, load }
}
