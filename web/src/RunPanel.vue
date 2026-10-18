<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type { ConsoleRunStartPayload, ConsoleStatusPayload } from '../../src/console/api-types.js'
import { consoleToken } from './console-token'
import OrphanPanel from './OrphanPanel.vue'

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

/**
 * Why the verdict is `defect`, in the verdict's own terms: the two facts the
 * report's `defects` block does not carry — a Gallery state that names another
 * Run (or could not be read), and claimed new files the probe rejected. The
 * third kind of cause, a defect class the runbook does not call routine, is in
 * that defects block, which the page shows beside this.
 */
const defectCauses = computed(() => {
  const payload = status.value
  const reasons = payload?.verdictReasons ?? null
  if (payload?.verdict !== 'defect' || reasons === null) return []
  const causes: string[] = []
  if (reasons.stateMatchesReport === false) {
    causes.push('the Gallery state names another Run')
  } else if (reasons.stateMatchesReport === null) {
    causes.push('the Gallery state could not be read, so the report was not matched against it')
  }
  if (reasons.missingOnDisk.length > 0) {
    causes.push(`claimed new files missing on disk: ${reasons.missingOnDisk.join(', ')}`)
  }
  return causes
})

/** The routine classes an `explained` verdict was made of, named the way `check-run` names them. */
const explainedCauses = computed(() => {
  const payload = status.value
  return payload?.verdict === 'explained' ? (payload.verdictReasons?.explained ?? []) : []
})

/** The status poll's handle; `null` when the page is not polling. */
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
      <!-- An Orphaned Run has its own component: it is the one state with an
           action, and the action is a POST the page must not get wrong. -->
      <OrphanPanel v-else-if="status.state === 'orphaned'" :status="status" @cleaned="readStatus" />
      <p v-else-if="status.runId === null">No Run log has been read.</p>
      <template v-else>
        <p>
          Run {{ status.runId }} — verdict: <strong>{{ status.verdict }}</strong>
        </p>
        <!-- The causes the report's `defects` block cannot carry: a `defect`
             whose defect block reads clean still has one of these to show
             (#34 story 11). -->
        <p v-if="defectCauses.length > 0" class="verdict-reasons">
          Why: {{ defectCauses.join('; ') }}
        </p>
        <template v-if="explainedCauses.length > 0">
          <p class="verdict-reasons">Explained (routine, recorded rather than failed):</p>
          <ul class="verdict-reasons">
            <li v-for="cause in explainedCauses" :key="cause">{{ cause }}</li>
          </ul>
        </template>
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

.verdict-reasons {
  color: #555;
  font-size: 0.9rem;
}
</style>
