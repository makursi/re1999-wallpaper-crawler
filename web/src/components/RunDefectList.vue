<script setup lang="ts">
import { computed } from 'vue'

import type { ConsoleDefects } from '../../api-types.js'
import { useConsoleStatus } from '../composables/useConsoleStatus'
import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'
import type { MessageRow } from '../i18n/messages'

const { status } = useConsoleStatus()

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
</script>

<template>
  <!-- The defect block as rows the page words, not the raw record. -->
  <p>{{ t('run.defects') }}</p>
  <ul v-if="defectRows.length > 0" class="list-disc pl-4 text-muted text-sm">
    <li v-for="row in defectRows" :key="row.key">
      <Message :message="row.key" :params="row.params" />
    </li>
  </ul>
  <p v-else class="text-muted text-sm">{{ t('defect.none') }}</p>
</template>
