<script setup lang="ts">
// ── The figures, in one line (#94) ──────────────────────────────────
//
// `Gallery N · downloaded N · missing N`, plus `· extra N` only when the Mirror
// holds retired files, or "Gallery unread" when the list could not be read. The
// wall's header renders this line and the Run panel will render the same one,
// from the same reading — so the two can never disagree about 1001 versus 1013
// (spec #93, story 9).
//
// The component is prop-driven and owns no read: `lib/gallery-figures.ts` is
// where the counts are computed, the dictionary owns the words, and the caller
// decides where the line stands. The root is a `<span>` so it can sit inside a
// paragraph or a flex row without nesting block elements.

import { computed } from 'vue'

import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'
import type { GalleryFigures } from '../lib/gallery-figures'

const props = defineProps<{
  /** The four counts; `null` = the page has not read the gallery yet. */
  figures: GalleryFigures | null
}>()

/** The line's counts, all present together — or `null` for "Gallery unread". */
const line = computed(() => {
  const figures = props.figures
  if (
    figures === null ||
    figures.officialTotal === null ||
    figures.downloaded === null ||
    figures.missing === null ||
    figures.extra === null
  ) {
    return null
  }
  return {
    officialTotal: figures.officialTotal,
    downloaded: figures.downloaded,
    missing: figures.missing,
    extra: figures.extra,
  }
})
</script>

<template>
  <span v-if="figures !== null">
    <!-- An unread list is a statement, not a zero: no missing count is claimed
         (ADR 0006). The retry beside it is the caller's. -->
    <template v-if="line === null">{{ t('gallery.unread') }}</template>
    <template v-else>
      <Message
        message="gallery.figures"
        :params="{
          officialTotal: line.officialTotal,
          downloaded: line.downloaded,
          missing: line.missing,
        }"
      />
      <!-- Retired local files are named as extras, and only when there are
           any: they are not downloads, so they never enter the three counts. -->
      <Message
        v-if="line.extra > 0"
        message="gallery.figuresExtra"
        :params="{ extra: line.extra }"
      />
    </template>
  </span>
</template>
