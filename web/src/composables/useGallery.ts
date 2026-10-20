// ── The wall's one read ─────────────────────────────────────────────
//
// `/api/gallery` is read once, when the wall is mounted. It is deliberately not
// polled: the Mirror changes only when a Run writes to it, and re-reading the
// wall under the reader's cursor mid-scroll is a worse answer than a stale one
// until the next reload. Refresh-on-Run-completion is a feature this refactor
// leaves alone.
//
// The read itself — the token, the error shape — is the client's
// (`lib/console-api.ts`); this composable only owns the wall's two values.

import type { Ref } from 'vue'
import { onMounted, ref } from 'vue'

import type { ConsoleGalleryPayload } from '../../api-types.js'
import { getJson } from '../lib/console-api.js'

export interface GalleryStore {
  gallery: Ref<ConsoleGalleryPayload | null>
  failure: Ref<string | null>
  /** Read the wall again. Not called today; it is the seam a later refresh uses. */
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

  return { gallery, failure, load }
}
