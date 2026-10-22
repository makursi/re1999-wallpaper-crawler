<script setup lang="ts">
// ── The Run panel's verdict, in two lines (#97) ─────────────────────
//
// What the last Run came to, in the reader's words: one verdict sentence and the
// `ok N · failed N` counts. The panel's figures line follows from `RunPanel.vue`,
// and its at-most-one problem line follows the figures — the order spec #93
// fixes. The run id, the timestamps, the log's file name, the Discovery
// counters, the success rate, the defect rows and the routine notes are all
// gone: a player asked "did it work, and what is missing", and this is the whole
// answer.
//
// The verdict sentence is the dictionary's (`VERDICT_MESSAGE_KEYS`); the counts
// are a rule, so they live in `lib/run-panel.ts` and are unit-tested there. This
// component only lays them out, which is why it renders message rows rather than
// deciding anything. The problem line is the panel's, not this component's,
// because the panel owns where it stands.
//
// A missing report has no verdict to name: `assessRun` calls it a defect in the
// log, and the panel's problem line is that sentence. The verdict sentence is
// therefore shown only when the status carries one, and the panel never presents
// "no conclusion" as a conclusion.

import { computed } from 'vue'

import { useConsoleStatus } from '../composables/useConsoleStatus'
import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'
import { VERDICT_MESSAGE_KEYS } from '../i18n/messages'
import { runCountsOf } from '../lib/run-panel'

const { status } = useConsoleStatus()

/** The one verdict sentence: the reader's word for the Run's result (#83). */
const verdictKey = computed(() => {
  const verdict = status.value?.verdict
  return verdict == null ? null : VERDICT_MESSAGE_KEYS[verdict]
})

/** `ok N`, plus ` · failed N` only when a download failed (never `failed 0`). */
const counts = computed(() => runCountsOf(status.value?.report ?? null))
</script>

<template>
  <template v-if="status !== null">
    <p v-if="verdictKey !== null">{{ t(verdictKey) }}</p>
    <!-- Every count is a data cell: `Message.vue` puts each one in the numeral
         role, and the sentence around them stays prose. -->
    <p v-if="counts.length > 0">
      <Message v-for="row in counts" :key="row.key" :message="row.key" :params="row.params" />
    </p>
  </template>
</template>
