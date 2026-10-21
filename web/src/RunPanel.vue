<script setup lang="ts">
import { computed } from 'vue'

import RunReportBlock from './components/RunReportBlock.vue'
import RunSetupNotice from './components/RunSetupNotice.vue'
import RunVerdict from './components/RunVerdict.vue'
import { useConsoleStatus } from './composables/useConsoleStatus'
import { useRunStart } from './composables/useRunStart'
import { t } from './i18n/locale'
import Message from './i18n/Message.vue'
import { startLabelKey } from './lib/run-start'
import OrphanPanel from './OrphanPanel.vue'

// The page's one status (`composables/useConsoleStatus.ts`): the panel shows the
// same snapshot the navigation's Mirror count is drawn from, and it no longer
// owns a poll of its own.
const { status, refresh } = useConsoleStatus()
// The page's one start (`composables/useRunStart.ts`): the wall's band offers
// the same control on an empty wall, and the two must never both look ready.
const { starting, refusalText, start } = useRunStart()

/**
 * Progress, in this project's own vocabulary: Wallpapers in the Mirror against
 * the Gallery total (#83). Both are live contract facts — the status route
 * re-counts the Mirror per read and the list's total is the same one the wall
 * uses — so a Run in flight reads "downloaded N of M" and not a spinner.
 */
const progressKey = computed(() =>
  status.value?.officialTotal == null ? 'wall.progressUnknownTotal' : 'wall.progress',
)
const progressParams = computed(() => ({
  done: status.value?.mirrorCount ?? 0,
  total: status.value?.officialTotal ?? 0,
}))

/** The start control's word: first fetch, continue, or another try after a problem. */
const startWord = computed(() =>
  t(startLabelKey(status.value?.mirrorCount ?? 0, status.value?.verdict === 'defect')),
)

/**
 * The newest Run could not reach the site. That is one plain sentence and the
 * start control (re-worded as "fetch again"), never the defect rows alone.
 */
const siteUnreachable = computed(
  () => status.value?.report?.defects.gallerySourceUnavailable === true,
)

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
      <!-- A Run in flight: the two counts, not a spinner (#83), and what
           closing the window means. There is no stop control (ADR 0016). -->
      <template v-if="status.state === 'running'">
        <p class="font-serif">{{ t('wall.runningHeading') }}</p>
        <p><Message :message="progressKey" :params="progressParams" /></p>
        <p class="text-muted text-sm">{{ t('wall.runningHint') }}</p>
      </template>
      <!-- An Orphaned Run has its own component: it is the one state with an
           action, and the action is a POST the page must not get wrong. -->
      <OrphanPanel v-else-if="status.state === 'orphaned'" :status="status" @cleaned="refresh" />
      <p v-else-if="status.runId === null">{{ t('run.noLog') }}</p>
      <template v-else>
        <RunVerdict />
        <RunReportBlock />
        <!-- One human sentence for the site being unreachable, with the start
             control below as the retry (#83). -->
        <p v-if="siteUnreachable" class="text-danger">{{ t('run.siteUnreachable') }}</p>
      </template>
    </template>

    <p>
      <button
        type="button"
        class="action-button"
        :disabled="starting || status?.state === 'running'"
        @click="start"
      >
        <!-- An action control: the regular Phosphor weight, never the light
             weight reserved for large marks and navigation. -->
        <span class="i-ph-play mr-1" aria-hidden="true" />{{ startWord }}
      </button>
    </p>
    <p v-if="refusalText !== null" class="text-danger">{{ refusalText }}</p>
  </section>
</template>
