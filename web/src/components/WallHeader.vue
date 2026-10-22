<script setup lang="ts">
// ── The wall's caption band ─────────────────────────────────────────
//
// The reading of the wall, not a panel: one line of numbers that answers "is the
// Mirror complete?" — `Gallery N · downloaded N · missing N`, and `· extra N`
// when the site has retired files the Mirror still holds. With the list unread
// the line says "Gallery unread": no missing count is claimed, and the Mirror's
// tiles are still below it (#94).
//
// The counts are `GalleryFigureCounts`, computed once in
// `lib/gallery-figures.ts` and rendered by the one component the Run panel
// shares, so the two surfaces cannot disagree about the same numbers. The
// eyebrow tag carries the Chinese name of the view, so the display mark leads
// and the reader still knows what this is (ADR 0015, story 20).
//
// A failed read is not printed here. The raw failure (`HTTP 500`, a transport
// message) is the service's vocabulary, not the reader's; #83 puts one plain
// sentence and a retry control in its place, and the retry is the view's — this
// component only asks for it.

import { computed } from 'vue'

import type { ConsoleGalleryPayload } from '../../api-types.js'
import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'
import { galleryFiguresOf } from '../lib/gallery-figures'
import GalleryFigures from './GalleryFigures.vue'

const props = defineProps<{
  /** The wall's one read; `null` until it arrives. */
  gallery: ConsoleGalleryPayload | null
  /** The read's own failure, if it had one. Only its presence is shown. */
  failure: string | null
}>()
const emit = defineEmits<{ retry: [] }>()

/** The line's counts, from the page's one gallery read. */
const figures = computed(() => galleryFiguresOf(props.gallery))

/** The newest-Run clause: only when it names something, never "added 0". */
const newestRunAdded = computed(() => {
  const added = props.gallery?.newSinceLastRun
  return added == null || added <= 0 ? null : added
})

/** Whether a retry control has anything to retry: a failed read or an unread list. */
const canRetry = computed(
  () => props.failure !== null || (props.gallery !== null && !props.gallery.listAvailable),
)
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
    <!-- One line: the Gallery list, what of it is on disk, what is not — and
         the newest Run's additions when there are any. -->
    <div class="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <p v-if="gallery !== null" class="text-secondary text-sm">
        <GalleryFigures :figures="figures" />
      </p>
      <p v-if="newestRunAdded !== null" class="text-secondary text-sm">
        <Message message="gallery.newestRunAdded" :params="{ newSinceLastRun: newestRunAdded }" />
      </p>
    </div>
    <p v-if="failure !== null" class="text-danger text-sm">{{ t('wall.readFailed') }}</p>
    <p v-else-if="gallery === null" class="text-muted text-sm">{{ t('gallery.reading') }}</p>
    <!-- The retry the failure sentence asks for: re-read the list and the
         Mirror, which is the only action either state has. -->
    <button
      v-if="canRetry"
      type="button"
      class="action-button self-start px-3 py-1 text-sm"
      @click="emit('retry')"
    >
      <span class="i-ph-arrow-clockwise mr-1" aria-hidden="true" />{{ t('action.retry') }}
    </button>
  </div>
</template>
