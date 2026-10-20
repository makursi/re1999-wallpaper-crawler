<script setup lang="ts">
import { computed, ref } from 'vue'

import type { ConsoleRunStartPayload } from '../api-types.js'
import RunReportBlock from './components/RunReportBlock.vue'
import RunSetupNotice from './components/RunSetupNotice.vue'
import RunVerdict from './components/RunVerdict.vue'
import { useConsoleStatus } from './composables/useConsoleStatus'
import { t } from './i18n/locale'
import Message from './i18n/Message.vue'
import type { RefusalView } from './i18n/refusal'
import { refusalFromError, refusalOf, refusalTextOf } from './i18n/refusal'
import { postJson } from './lib/console-api'
import OrphanPanel from './OrphanPanel.vue'

// The page's one status (`composables/useConsoleStatus.ts`): the panel shows the
// same snapshot the navigation's Mirror count is drawn from, and it no longer
// owns a poll of its own.
const { status, refresh } = useConsoleStatus()
/** The last refusal, in the three shapes the page can meet one (#47). */
const refusal = ref<RefusalView | null>(null)
const starting = ref(false)

/** The refusal as one sentence; `null` when there is none to show. */
const refusalText = computed(() => refusalTextOf(refusal.value, 'run.refusedStart'))

/**
 * Progress, in this project's own vocabulary: Wallpapers in the Mirror against
 * the Gallery total. Both come from contract facts — the Mirror's file count
 * and the Gallery list — never from a per-file record in the Run log.
 */
const progress = computed(() => {
  const mirror = status.value?.mirrorCount ?? 0
  const total = status.value?.officialTotal
  return total === null || total === undefined
    ? t('app.wallpapersInMirror', { count: mirror })
    : t('app.mirrorAgainstTotal', { count: mirror, total })
})

/** The in-flight line's one parameter: the Mirror-against-total progress phrase. */
const inFlightParams = computed(() => ({ progress: progress.value }))

async function startRun(): Promise<void> {
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
    // The Run's identity is its log, so it is read back rather than assumed.
    await refresh()
  } catch (error) {
    // A transport failure is a runtime message, not copy (docs/adr/0014).
    refusal.value = refusalFromError(error)
  } finally {
    starting.value = false
  }
}

// Closing the page never stops a Run: nothing here owns a Run, and there is no
// stop control to add (ADR 0009). The first status read belongs to the store,
// and so does the poll it keeps while a Run is in flight.
</script>

<template>
  <!-- The panel is the drawer's content now (#48), so it owns no outer margin:
       the layer's own gap spaces it from the drawer's title. -->
  <section>
    <!-- The panel's heading is a Chinese heading role, so it takes `font-serif`
         even though its label is Latin today — that is the stack's Latin display
         face doing its job. Every value this panel interpolates is a data cell
         and renders through `Message.vue`, which is what puts the run id,
         timestamps and counts in the numeral role (#49); the surrounding words
         stay in the body face. -->
    <h2 class="font-serif text-[1.1rem] font-bold">{{ t('run.heading') }}</h2>

    <RunSetupNotice />

    <p v-if="status === null">{{ t('run.readingLog') }}</p>

    <template v-else>
      <p v-if="status.state === 'running'">
        <Message message="run.inFlight" :params="inFlightParams" />
      </p>
      <!-- An Orphaned Run has its own component: it is the one state with an
           action, and the action is a POST the page must not get wrong. -->
      <OrphanPanel v-else-if="status.state === 'orphaned'" :status="status" @cleaned="refresh" />
      <p v-else-if="status.runId === null">{{ t('run.noLog') }}</p>
      <template v-else>
        <RunVerdict />
        <RunReportBlock />
      </template>
    </template>

    <p>
      <button
        type="button"
        class="action-button"
        :disabled="starting || status?.state === 'running'"
        @click="startRun"
      >
        <!-- An action control: the regular Phosphor weight, never the light
             weight reserved for large marks and navigation. -->
        <span class="i-ph-play mr-1" aria-hidden="true" />{{ t('run.start') }}
      </button>
    </p>
    <p v-if="refusalText !== null" class="text-danger">{{ refusalText }}</p>
  </section>
</template>
