<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type {
  ConsoleDefects,
  ConsoleExplainedReason,
  ConsoleRunStartPayload,
  ConsoleStatusPayload,
  ConsoleVerdict,
} from '../api-types.js'
import { consoleToken } from './console-token'
import { t } from './i18n/locale'
import Message from './i18n/Message.vue'
import { EXPLAINED_REASON_MESSAGE_KEYS, VERDICT_MESSAGE_KEYS } from './i18n/messages'
import type { MessageKey, MessageParams } from './i18n/messages'
import type { RefusalView } from './i18n/refusal'
import { refusalFromError, refusalOf, refusalTextOf } from './i18n/refusal'
import OrphanPanel from './OrphanPanel.vue'

const status = ref<ConsoleStatusPayload | null>(null)
/** The last refusal, in the three shapes the page can meet one (#47). */
const refusal = ref<RefusalView | null>(null)
const starting = ref(false)

/** One dictionary row: a message key and the values it interpolates. */
interface MessageRow {
  key: MessageKey
  params?: MessageParams
}

/** The refusal as one sentence; `null` when there is none to show. */
const refusalText = computed(() => refusalTextOf(refusal.value, 'run.refusedStart'))

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

/** The Run report's Gallery numbers, in the panel's words. */
const galleryLine = computed(() => {
  const gallery = status.value?.report?.gallery
  if (gallery === undefined) return ''
  return t('run.galleryReport', {
    officialTotal: gallery.officialTotal ?? t('run.unknown'),
    newSinceLastRun: gallery.newSinceLastRun ?? t('run.unknown'),
    newFiles: gallery.newFiles.length,
  })
})

/** The Run report's Download numbers, in the panel's words. */
const downloadLine = computed(() => {
  const download = status.value?.report?.download
  if (download === undefined) return ''
  return t('run.downloadReport', {
    ok: download.ok,
    skipped: download.skipped,
    failed: download.failed,
    successRate: download.successRate,
  })
})

/**
 * The detected defects, as rows the page words itself (#47). The report's
 * `defects` record is structured data already; what used to be printed as one
 * JSON blob is named here class by class, in the reader's language.
 */
const defectRows = computed<MessageRow[]>(() => {
  const report = status.value?.report
  return report === null || report === undefined ? [] : rowsOfDefects(report.defects)
})

/**
 * One row per defect class the record actually reports. A `null` Mirror gap or
 * Site asset check is "not checked" — never folded into "clean" — and gets its
 * own row.
 */
function rowsOfDefects(defects: ConsoleDefects): MessageRow[] {
  const rows: MessageRow[] = []
  if (defects.discoveryLeak.count > 0) {
    rows.push({ key: 'defect.discoveryLeak', params: { count: defects.discoveryLeak.count } })
  }
  if (defects.nonConverged) rows.push({ key: 'defect.nonConverged' })
  if (defects.emptyResult) rows.push({ key: 'defect.emptyResult' })
  if (defects.persistentFailures > 0) {
    rows.push({ key: 'defect.persistentFailures', params: { count: defects.persistentFailures } })
  }
  if (defects.emptyFiles.length > 0) {
    rows.push({ key: 'defect.emptyFiles', params: { files: defects.emptyFiles.join(', ') } })
  }
  if (defects.siteAssetFalsePositive === null) {
    rows.push({ key: 'defect.siteAssetNotChecked' })
  } else if (defects.siteAssetFalsePositive.count > 0) {
    rows.push({
      key: 'defect.siteAssetFalsePositive',
      params: { count: defects.siteAssetFalsePositive.count },
    })
  }
  if (defects.gallerySourceUnavailable) rows.push({ key: 'defect.gallerySourceUnavailable' })
  if (defects.mirrorGap === null) {
    rows.push({ key: 'defect.mirrorGapNotChecked' })
  } else if (defects.mirrorGap.missing > 0) {
    rows.push({ key: 'defect.mirrorGapMissing', params: { count: defects.mirrorGap.missing } })
  }
  if (defects.mirrorGap !== null && defects.mirrorGap.extra > 0) {
    rows.push({ key: 'defect.mirrorGapExtra', params: { count: defects.mirrorGap.extra } })
  }
  return rows
}

/**
 * Why there is no verdict to show. A missing Run report is a defect in the log
 * — never "the Run failed" — and a report this Console cannot read is a
 * different statement, so the two are not merged.
 */
const missingReport = computed(() =>
  status.value?.reportPresent === true ? t('run.reportUnreadable') : t('run.reportMissing'),
)

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
    // web/api-types.ts, and imported here as a type only.
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
      // The service sends a code and its parameters; the sentence is the
      // dictionary's, in the reader's language (#47). A body without one is an
      // HTTP refusal (the guard's 403), named by its status instead.
      refusal.value = refusalOf(response.status, body.refusal)
      return
    }
    // The Run's identity is its log, so it is read back rather than assumed.
    await readStatus()
  } catch (error) {
    // A transport failure is a runtime message, not copy (docs/adr/0014).
    refusal.value = refusalFromError(error)
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

    <p v-if="status === null">{{ t('run.readingLog') }}</p>

    <template v-else>
      <p v-if="status.state === 'running'">
        <Message message="run.inFlight" :params="inFlightParams" />
      </p>
      <!-- An Orphaned Run has its own component: it is the one state with an
           action, and the action is a POST the page must not get wrong. -->
      <OrphanPanel v-else-if="status.state === 'orphaned'" :status="status" @cleaned="readStatus" />
      <p v-else-if="status.runId === null">{{ t('run.noLog') }}</p>
      <template v-else>
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
        <p v-if="status.report === null" class="text-danger">{{ missingReport }}</p>
        <template v-else>
          <p><Message message="run.gallery" :params="{ line: galleryLine }" /></p>
          <p><Message message="run.download" :params="{ line: downloadLine }" /></p>
          <!-- The defect block as rows the page words, not the raw record. -->
          <p>{{ t('run.defects') }}</p>
          <ul v-if="defectRows.length > 0" class="list-disc pl-4 text-muted text-sm">
            <li v-for="row in defectRows" :key="row.key">
              <Message :message="row.key" :params="row.params" />
            </li>
          </ul>
          <p v-else class="text-muted text-sm">{{ t('defect.none') }}</p>
        </template>
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
