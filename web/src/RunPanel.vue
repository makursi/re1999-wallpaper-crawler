<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type { ConsoleRunStartPayload, ConsoleStatusPayload } from '../../src/console/api-types.js'

const status = ref<ConsoleStatusPayload | null>(null)
/** A refusal's own words, shown verbatim rather than swallowed. */
const refusal = ref<string | null>(null)
const starting = ref(false)

/**
 * Progress, in this project's own vocabulary: Wallpapers in the Mirror against
 * the Gallery total. Both come from contract facts — the Mirror's file count
 * and the Gallery list — never from a per-file record in the Run log.
 */
const progress = computed(() => {
  const mirror = status.value?.mirrorCount ?? 0
  const total = status.value?.officialTotal
  return total === null || total === undefined
    ? `${mirror} Wallpapers in the Mirror`
    : `${mirror} Wallpapers in the Mirror against a Gallery total of ${total}`
})

/** The Run report's Gallery numbers, verbatim. */
const galleryLine = computed(() => {
  const gallery = status.value?.report?.gallery
  if (gallery === undefined) return ''
  return `officialTotal ${gallery.officialTotal ?? 'unknown'}, newSinceLastRun ${gallery.newSinceLastRun ?? 'unknown'}, newFiles ${gallery.newFiles.length}`
})

/** The Run report's Download numbers, verbatim. */
const downloadLine = computed(() => {
  const download = status.value?.report?.download
  if (download === undefined) return ''
  return `ok ${download.ok}, skipped ${download.skipped}, failed ${download.failed}, successRate ${download.successRate}`
})

/** The detected defects, verbatim from the Run report, as `check-run` prints them. */
const defects = computed(() => {
  const report = status.value?.report
  return report === null || report === undefined ? '' : JSON.stringify(report.defects)
})

/**
 * Why there is no verdict to show. A missing Run report is a defect in the log
 * — never "the Run failed" — and a report this Console cannot read is a
 * different statement, so the two are not merged.
 */
const missingReport = computed(() =>
  status.value?.reportPresent === true
    ? 'The Run log carries a Run report this Console cannot read — an older Run contract? Not a missing report, and not proof the Run failed.'
    : 'The Run log stops before its Run report — a defect in the log, not proof the Run failed.',
)

/** The token this page was opened with; the service wants it on every request. */
function consoleToken(): string {
  return new URLSearchParams(window.location.search).get('token') ?? ''
}

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Poll only while a Run is in flight. An idle Console's page asks nothing, so a
 * tab left open for hours costs nothing; there are no websockets and no second
 * channel to keep in sync with the Run log.
 */
function stopPolling(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

function startPolling(): void {
  if (timer !== null) return
  timer = setInterval(() => void readStatus(), 5000)
}

async function readStatus(): Promise<void> {
  try {
    const response = await fetch(`/api/status?token=${encodeURIComponent(consoleToken())}`)
    if (!response.ok) return
    // The service's own payload; its shape is declared once, in
    // src/console/api-types.ts, and imported here as a type only.
    const payload = (await response.json()) as ConsoleStatusPayload
    status.value = payload
    if (payload.state === 'running') startPolling()
    else stopPolling()
  } catch {
    // A failed read leaves the last known view in place rather than blanking it.
  }
}

async function startRun(): Promise<void> {
  starting.value = true
  refusal.value = null
  try {
    const response = await fetch(`/api/run?token=${encodeURIComponent(consoleToken())}`, {
      method: 'POST',
    })
    const body = (await response.json()) as ConsoleRunStartPayload
    if (!response.ok || !body.started) {
      // 409's reason and 412's missing prerequisite, verbatim.
      refusal.value = body.reason ?? `the Console refused the start (HTTP ${response.status})`
      return
    }
    // The Run's identity is its log, so it is read back rather than assumed.
    await readStatus()
  } catch (error) {
    refusal.value = error instanceof Error ? error.message : String(error)
  } finally {
    starting.value = false
  }
}

onMounted(() => {
  void readStatus()
})

// Closing the page never stops a Run: nothing here owns a Run, and there is no
// stop control to add (ADR 0009). Only this page's own polling is released.
onUnmounted(stopPolling)
</script>

<template>
  <section class="run">
    <h2>Run</h2>

    <p v-if="status === null">Reading the Run log…</p>

    <template v-else>
      <p v-if="status.state === 'running'">A Run is in flight: {{ progress }}.</p>
      <p v-else-if="status.state === 'orphaned'">
        Orphaned Run {{ status.runId }}: a Run log with no Run report, written recently. It may
        still be writing — cleaning it up is offered, not forced.
      </p>
      <p v-else-if="status.runId === null">No Run log has been read.</p>
      <template v-else>
        <p>
          Run {{ status.runId }} — verdict: <strong>{{ status.verdict }}</strong>
        </p>
        <p v-if="status.report === null" class="refusal">{{ missingReport }}</p>
        <template v-else>
          <p>Gallery: {{ galleryLine }}</p>
          <p>Download: {{ downloadLine }}</p>
          <p>
            Defects: <code>{{ defects }}</code>
          </p>
        </template>
      </template>
    </template>

    <p>
      <button type="button" :disabled="starting || status?.state === 'running'" @click="startRun">
        Start a Run
      </button>
    </p>
    <p v-if="refusal !== null" class="refusal">{{ refusal }}</p>
  </section>
</template>

<style scoped>
.run {
  margin-top: 2rem;
}

h2 {
  font-size: 1.1rem;
}

button {
  font: inherit;
  padding: 0.4rem 0.9rem;
}

code {
  word-break: break-all;
}

.refusal {
  color: #a33;
}
</style>
