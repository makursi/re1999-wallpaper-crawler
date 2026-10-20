<script setup lang="ts">
import { computed } from 'vue'

import type { ConsoleExplainedReason, ConsoleVerdict } from '../../api-types.js'
import { useConsoleStatus } from '../composables/useConsoleStatus'
import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'
import { EXPLAINED_REASON_MESSAGE_KEYS, VERDICT_MESSAGE_KEYS } from '../i18n/messages'
import type { MessageRow } from '../i18n/messages'

const { status } = useConsoleStatus()

/**
 * The verdict as the page says it: `check-run` prints the `clean|explained|defect`
 * code and the service ships it untouched, while the reader's word for it is the
 * page's — the mapping is in the dictionary, not in the service (docs/adr/0014).
 * The empty string means there is no verdict to show.
 */
function verdictLabel(code: ConsoleVerdict | null): string {
  return code === null ? '' : t(VERDICT_MESSAGE_KEYS[code])
}

/**
 * Why the verdict is `defect`, in the verdict's own terms: the two facts the
 * report's `defects` record does not carry — a Gallery state that names another
 * Run (or could not be read), and claimed new files the probe rejected. The
 * third kind of cause, a defect class the runbook does not call routine, is in
 * that `defects` record, which the page shows beside this.
 */
const defectCauses = computed(() => {
  const payload = status.value
  const reasons = payload?.verdictReasons ?? null
  if (payload?.verdict !== 'defect' || reasons === null) return []
  const causes: string[] = []
  if (reasons.stateMatchesReport === false) {
    causes.push(t('run.cause.stateNamesAnotherRun'))
  } else if (reasons.stateMatchesReport === null) {
    causes.push(t('run.cause.stateUnreadable'))
  }
  if (reasons.missingOnDisk.length > 0) {
    causes.push(t('run.cause.missingOnDisk', { files: reasons.missingOnDisk.join(', ') }))
  }
  return causes
})

/** The causes as one sentence; empty when there are none to show. */
const why = computed(() =>
  defectCauses.value.length === 0
    ? ''
    : t('run.why', { causes: defectCauses.value.join(t('run.causeSeparator')) }),
)

/**
 * The routine classes an `explained` verdict was made of, as dictionary rows.
 * The verdict carries them as structured reasons (#47) with English field names;
 * the page says each kind in the reader's language.
 */
const explainedCauses = computed<MessageRow[]>(() => {
  const payload = status.value
  if (payload?.verdict !== 'explained') return []
  return (payload.verdictReasons?.explained ?? []).map(explainedRow)
})

/** One explained reason, as the message that words it. */
function explainedRow(reason: ConsoleExplainedReason): MessageRow {
  const key = EXPLAINED_REASON_MESSAGE_KEYS[reason.kind]
  return reason.kind === 'discovery-leak'
    ? { key, params: { urls: reason.urls.join(', ') } }
    : { key, params: { count: reason.count } }
}
</script>

<template>
  <template v-if="status !== null">
    <p>
      <Message
        message="run.line"
        :params="{ runId: status.runId ?? '', verdict: verdictLabel(status.verdict) }"
      />
    </p>
    <!-- The causes the report's `defects` record cannot carry: a `defect`
         whose record reads clean still has one of these to show
         (#34 story 11). -->
    <p v-if="why !== ''" class="text-muted text-sm">{{ why }}</p>
    <!-- The routine classes the verdict explained, each a dictionary
         message: the service sends structured reasons, never a sentence. -->
    <template v-if="explainedCauses.length > 0">
      <p class="text-muted text-sm">{{ t('run.explained') }}</p>
      <ul class="list-disc pl-4 text-muted text-sm">
        <li v-for="cause in explainedCauses" :key="cause.key">
          <Message :message="cause.key" :params="cause.params" />
        </li>
      </ul>
    </template>
  </template>
</template>
