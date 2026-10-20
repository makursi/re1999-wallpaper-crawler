<script setup lang="ts">
// ── The wall's caption band ─────────────────────────────────────────
//
// The reading of the wall, not a panel: what the list said, what the Mirror
// holds, and what the two disagree about. The eyebrow tag carries the Chinese
// name of the view, so the display mark leads and the reader still knows what
// this is (ADR 0015, story 20).

import { computed } from 'vue'

import type { ConsoleGalleryPayload } from '../../api-types.js'
import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'

const props = defineProps<{
  /** The wall's one read; `null` until it arrives. */
  gallery: ConsoleGalleryPayload | null
  /** The read's own failure, if it had one. */
  failure: string | null
}>()

/** The official total as the reader sees it: a number, or "not read". */
const officialTotal = computed(() => {
  const total = props.gallery?.officialTotal
  return total == null ? t('gallery.notRead') : total
})

/** The newest-Run clause, or nothing when there is nothing to compare against. */
const newestRunAdded = computed(() => props.gallery?.newSinceLastRun ?? undefined)
</script>

<template>
  <!-- The wall's head: the caption is the reading of the wall, not a panel,
       and above it sits the position the site fills with a WALLPAPER type
       image — filled here with real text and no image at all (ADR 0015,
       story 20). The eyebrow tag carries the Chinese name of the view, so the
       display mark leads and the reader still knows what this is. -->
  <div class="mb-10 flex flex-col gap-4">
    <h2
      class="flex items-center gap-3 font-serif text-xs font-bold text-muted uppercase tracking-[0.35em]"
    >
      <span class="h-px w-10 bg-border" aria-hidden="true" />
      {{ t('gallery.heading') }}
    </h2>
    <!-- The display mark: Playfair Display at display scale, in the site's
         own logotype ink. A logotype is the same word in both locales, so it
         is a dictionary key with one value rather than a translation. -->
    <p class="font-serif text-7xl leading-none tracking-[0.12em] text-logotype">
      {{ t('wall.mark') }}
    </p>
    <div class="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <p v-if="gallery !== null" class="text-secondary text-sm">
        <Message
          message="gallery.counts"
          :params="{ officialTotal, mirrorCount: gallery.mirrorCount }"
        />
      </p>
      <p v-if="newestRunAdded !== undefined" class="text-secondary text-sm">
        <Message message="gallery.newestRunAdded" :params="{ newSinceLastRun: newestRunAdded }" />
      </p>
    </div>
    <p v-if="failure !== null" class="text-danger text-sm">{{ failure }}</p>
    <p v-else-if="gallery === null" class="text-muted text-sm">{{ t('gallery.reading') }}</p>
    <p v-else-if="!gallery.listAvailable" class="max-w-[52rem] text-muted text-sm">
      {{ t('gallery.listUnavailable') }}
    </p>
    <p v-else-if="gallery.mirrorGap !== null" class="max-w-[52rem] text-muted text-sm">
      <Message
        message="gallery.mirrorGap"
        :params="{ missing: gallery.mirrorGap.missing, extra: gallery.mirrorGap.extra }"
      />
    </p>
  </div>
</template>
