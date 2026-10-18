<script setup lang="ts">
import { computed, ref } from 'vue'

import type { ConsoleRunCleanupPayload, ConsoleStatusPayload } from '../../src/console/api-types.js'

/**
 * An Orphaned Run, and the one action the page offers for it (#36).
 *
 * This is a view, like the rest of the page: the cleanup closes the leftover
 * Browser session and acknowledges the log's claim, and it never touches the
 * Run log. The log is the audit trail (ADR 0007); the acknowledgement is in
 * memory, so a Console restart reports the same leftover again.
 */
const props = defineProps<{ status: ConsoleStatusPayload }>()
const emit = defineEmits<{ cleaned: [] }>()

const cleaning = ref(false)
/** A refusal's own words, shown verbatim rather than swallowed. */
const refusal = ref<string | null>(null)

/** The log name the status carries; the Run's id is all there is without one. */
const logName = computed(() => props.status.runLogName ?? 'its newest Run log')

/** The token this page was opened with; the service wants it on every request. */
function consoleToken(): string {
  return new URLSearchParams(window.location.search).get('token') ?? ''
}

async function cleanUp(): Promise<void> {
  cleaning.value = true
  refusal.value = null
  try {
    const response = await fetch(`/api/run/cleanup?token=${encodeURIComponent(consoleToken())}`, {
      method: 'POST',
    })
    const body = (await response.json()) as ConsoleRunCleanupPayload
    if (!response.ok || !body.cleaned) {
      // 409 is the only refusal: a Run in flight is never cleaned under.
      refusal.value = body.reason ?? `the Console refused the cleanup (HTTP ${response.status})`
      return
    }
    // The Run's state is read back rather than assumed, as after a start.
    emit('cleaned')
  } catch (error) {
    refusal.value = error instanceof Error ? error.message : String(error)
  } finally {
    cleaning.value = false
  }
}
</script>

<template>
  <section class="orphan">
    <p>
      Orphaned Run <strong>{{ status.runId }}</strong> — the Run log
      <code>{{ logName }}</code> has no Run report and was written recently.
    </p>
    <p class="caveat">
      Cleaning it up is offered, not forced: it may still be a Run that is writing, and the log
      directory alone cannot tell the two apart. The cleanup closes the leftover Browser session and
      withdraws this notice; the Run log itself is never edited or deleted, because it is the Run's
      audit trail.
    </p>
    <p>
      <button type="button" :disabled="cleaning" @click="cleanUp">Clean up</button>
    </p>
    <p v-if="refusal !== null" class="refusal">{{ refusal }}</p>
  </section>
</template>

<style scoped>
.orphan {
  margin-top: 1rem;
}

.caveat {
  color: #555;
  font-size: 0.9rem;
}

code {
  word-break: break-all;
}

button {
  font: inherit;
  padding: 0.4rem 0.9rem;
}

.refusal {
  color: #a33;
}
</style>
