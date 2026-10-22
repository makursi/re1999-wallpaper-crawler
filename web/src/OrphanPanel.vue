<script setup lang="ts">
import { computed, ref } from 'vue'

import type { ConsoleRunCleanupPayload, ConsoleStatusPayload } from '../api-types.js'
import { t } from './i18n/locale'
import Message from './i18n/Message.vue'
import type { RefusalView } from './i18n/refusal'
import { refusalFromError, refusalOf, refusalTextOf } from './i18n/refusal'
import { postJson } from './lib/console-api'

/**
 * An Orphaned Run, and the one action the page offers for it (#36, #97).
 *
 * One sentence and the control — the long explanation paragraph is gone. The
 * cleanup closes the leftover Browser session and acknowledges the log's claim,
 * and it never touches the Run log: the log is the audit trail (ADR 0007), and
 * the acknowledgement is in memory, so a Console restart reports the same
 * leftover again. That the cleanup refuses to run under a Run in flight is the
 * service's decision; the page only words the refusal.
 *
 * This is a view, like the rest of the page.
 */
const props = defineProps<{ status: ConsoleStatusPayload }>()
const emit = defineEmits<{ cleaned: [] }>()

const cleaning = ref(false)
/** The cleanup's refusal, in the three shapes the page can meet one (#47). */
const refusal = ref<RefusalView | null>(null)

/** The refusal as one sentence; `null` when there is none to show. */
const refusalText = computed(() => refusalTextOf(refusal.value, 'orphan.refusedCleanup'))

/** The log name the status carries; the Run's id is all there is without one. */
const logName = computed(() => props.status.runLogName ?? t('orphan.newestLog'))

async function cleanUp(): Promise<void> {
  cleaning.value = true
  refusal.value = null
  try {
    // The client module owns the token and the error shape; this panel owns only
    // the words for a refusal (#47).
    const reply = await postJson<ConsoleRunCleanupPayload>('/api/run/cleanup')
    if (!reply.ok || !reply.body.cleaned) {
      // 409 is the only refusal: a Run in flight is never cleaned under. The
      // service says so with a code; the dictionary says it in words (#47).
      refusal.value = refusalOf(reply.status, reply.body.refusal)
      return
    }
    // The Run's state is read back rather than assumed, as after a start.
    emit('cleaned')
  } catch (error) {
    refusal.value = refusalFromError(error)
  } finally {
    cleaning.value = false
  }
}
</script>

<template>
  <section class="mt-4">
    <!-- The state is derived from a log, so the id is there; `?? ''` is only
         because the payload's type cannot say that. The Run's id and the log's
         name are both data cells, so they take the numeral role (#49). -->
    <p>
      <Message message="orphan.line" :params="{ runId: status.runId ?? '', logName: logName }" />
    </p>
    <p>
      <button type="button" class="action-button" :disabled="cleaning" @click="cleanUp">
        <span class="i-ph-broom mr-1" aria-hidden="true" />{{ t('orphan.clean') }}
      </button>
    </p>
    <p v-if="refusalText !== null" class="text-danger">{{ refusalText }}</p>
  </section>
</template>
