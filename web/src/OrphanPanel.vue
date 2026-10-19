<script setup lang="ts">
import { computed, ref } from 'vue'

import type { ConsoleRunCleanupPayload, ConsoleStatusPayload } from '../api-types.js'
import { consoleToken } from './console-token'

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
  <section class="mt-4">
    <p>
      Orphaned Run <strong class="numeric">{{ status.runId }}</strong> — the Run log
      <code class="break-all">{{ logName }}</code> has no Run report and was written recently.
    </p>
    <p class="text-muted text-sm">
      Cleaning it up is offered, not forced: it may still be a Run that is writing, and the log
      directory alone cannot tell the two apart. The cleanup closes the leftover Browser session and
      withdraws this notice; the Run log itself is never edited or deleted, because it is the Run's
      audit trail.
    </p>
    <p>
      <button
        type="button"
        class="cursor-pointer rounded-sm border border-border bg-surface px-[0.9rem] py-[0.4rem] transition-colors duration-hover ease-standard hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="cleaning"
        @click="cleanUp"
      >
        <span class="i-ph-broom mr-1" aria-hidden="true" />Clean up
      </button>
    </p>
    <p v-if="refusal !== null" class="text-danger">{{ refusal }}</p>
  </section>
</template>
