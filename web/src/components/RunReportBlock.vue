<script setup lang="ts">
import { computed } from 'vue'

import { useConsoleStatus } from '../composables/useConsoleStatus'
import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'
import RunDefectList from './RunDefectList.vue'

const { status } = useConsoleStatus()

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
 * Why there is no verdict to show. A missing Run report is a defect in the log
 * — never "the Run failed" — and a report this Console cannot read is a
 * different statement, so the two are not merged.
 */
const missingReport = computed(() =>
  status.value?.reportPresent === true ? t('run.reportUnreadable') : t('run.reportMissing'),
)
</script>

<template>
  <template v-if="status !== null">
    <p v-if="status.report === null" class="text-danger">{{ missingReport }}</p>
    <template v-else>
      <p><Message message="run.gallery" :params="{ line: galleryLine }" /></p>
      <p><Message message="run.download" :params="{ line: downloadLine }" /></p>
      <RunDefectList />
    </template>
  </template>
</template>
