// ── The wall's one read ─────────────────────────────────────────────
//
// `/api/gallery` is read once, when the wall is mounted. It is deliberately not
// polled: the Mirror changes only when a Run writes to it, and re-reading the
// wall under the reader's cursor mid-scroll is a worse answer than a stale one
// until the next reload.
//
// The one exception is a Run that stops writing (#83): its last files are the
// wall's new tiles, and the page's empty state must turn into the wall the
// reader just waited for rather than stay empty beside a status that already
// says "1010 of 1010". The status store is the page's clock, so the read
// follows the Run's end and nothing else.
//
// The read itself — the token, the error shape — is the client's
// (`lib/console-api.ts`); this composable only owns the wall's two values.

import type { Ref } from 'vue'
import { onMounted, ref, watch } from 'vue'

import type { ConsoleGalleryPayload } from '../../api-types.js'
import { getJson } from '../lib/console-api.js'
import { useConsoleStatus } from './useConsoleStatus'

export interface GalleryStore {
  gallery: Ref<ConsoleGalleryPayload | null>
  failure: Ref<string | null>
  /** Read the wall again. Also the retry a failed read offers (#83). */
  load: () => Promise<void>
}

export function useGallery(): GalleryStore {
  const gallery = ref<ConsoleGalleryPayload | null>(null)
  const failure = ref<string | null>(null)

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

  onMounted(() => {
    void load()
  })

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

  return { gallery, failure, load }
}
