<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import type { ConsoleGalleryPayload, ConsoleGalleryRow } from '../api-types.js'
import { consoleToken } from './console-token'
import FullSizeView from './FullSizeView.vue'
import { t } from './i18n/locale'
import Message from './i18n/Message.vue'
import type { MessageKey } from './i18n/messages'

const gallery = ref<ConsoleGalleryPayload | null>(null)
const failure = ref<string | null>(null)
/** The tile whose full-size view is open; `null` when none is. */
const opened = ref<ConsoleGalleryRow | null>(null)

async function loadGallery(): Promise<void> {
  try {
    const response = await fetch(`/api/gallery?token=${encodeURIComponent(consoleToken())}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    // The service's own payload; its shape is declared once, in
    // web/api-types.ts, and imported here as a type only.
    gallery.value = (await response.json()) as ConsoleGalleryPayload
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => {
  void loadGallery()
})

/**
 * The image extensions the service serves (`IMAGE_EXTENSIONS`,
 * core/wallpaper-url.ts). A `not-in-gallery` file can be any non-dot name the
 * Mirror holds, so the tile asks for a thumbnail only when the name could be
 * an image at all — otherwise the request is a guaranteed 400 per tile.
 */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/** The states as the page says them, key for key — a row state with no message is a compile error. */
const STATE_LABEL_KEYS: Record<ConsoleGalleryRow['state'], MessageKey> = {
  'on-disk': 'gallery.state.onDisk',
  missing: 'gallery.state.missing',
  'not-in-gallery': 'gallery.state.notInGallery',
}

/**
 * The tone each state reads in. The two absent states are the danger token; a
 * file that is simply there takes the page's own text level, which is why its
 * entry is empty rather than a class.
 */
const STATE_TONES: Record<ConsoleGalleryRow['state'], string> = {
  'on-disk': '',
  missing: 'text-danger',
  'not-in-gallery': 'text-danger',
}

/** The official total as the reader sees it: a number, or "not read". */
const officialTotal = computed(() => {
  const total = gallery.value?.officialTotal
  return total == null ? t('gallery.notRead') : total
})

/** The newest-Run clause, or nothing when there is nothing to compare against. */
const newestRunAdded = computed(() => gallery.value?.newSinceLastRun ?? undefined)

/** `true` when a file with this name stands a chance of being an image. */
function isImageName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && IMAGE_EXTENSIONS.includes(name.slice(dot).toLowerCase())
}

/** `true` when the tile can show a thumbnail at all. */
function isViewable(row: ConsoleGalleryRow): boolean {
  if (row.state === 'missing') return false
  return isImageName(row.name)
}

/**
 * A tile's thumbnail URL — the cache-backed route, with the token on it the way
 * every other request carries it.
 */
function thumbnailUrl(name: string): string {
  return `/api/thumbnail/${encodeURIComponent(name)}?token=${encodeURIComponent(consoleToken())}`
}

/** An id the page can key a row by: an entry's own, or a Mirror file's name. */
function rowKey(row: ConsoleGalleryRow): string {
  return `${row.id ?? 'no-id'} ${row.name}`
}
</script>

<template>
  <section class="mt-8">
    <!-- The wall's heading is a Chinese heading role (`font-serif`), and every
         count and id on this view — the two list totals, the counters in the
         gap line, and each row's gallery id — is a numeral cell and takes
         `numeric` (#49). A row's file name stays a `code` identifier: it is
         dense data, and the reset already renders it in the numeral role's
         family. The counts and the ids that live inside a sentence are the
         values of a dictionary message, so they render through `Message.vue`,
         which marks exactly those pieces. -->
    <h2 class="font-serif text-xl font-bold">{{ t('gallery.heading') }}</h2>
    <p v-if="failure !== null">{{ failure }}</p>
    <p v-else-if="gallery === null">{{ t('gallery.reading') }}</p>
    <template v-else>
      <p>
        <Message
          message="gallery.counts"
          :params="{ officialTotal: officialTotal, mirrorCount: gallery.mirrorCount }"
        />
      </p>
      <p v-if="newestRunAdded !== undefined">
        <Message message="gallery.newestRunAdded" :params="{ newSinceLastRun: newestRunAdded }" />
      </p>
      <p v-if="!gallery.listAvailable">{{ t('gallery.listUnavailable') }}</p>
      <p v-else-if="gallery.mirrorGap !== null">
        <Message
          message="gallery.mirrorGap"
          :params="{ missing: gallery.mirrorGap.missing, extra: gallery.mirrorGap.extra }"
        />
      </p>
      <!-- The wall is a grid of tiles, each a token-styled surface with the
           1px border reserved up front, so hovering swaps its colour without
           moving anything. -->
      <ul class="mt-4 grid list-none grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 p-0">
        <li v-for="row in gallery.rows" :key="rowKey(row)">
          <button
            v-if="isViewable(row)"
            type="button"
            class="grid h-[10rem] w-full cursor-pointer place-items-center overflow-hidden rounded-sm border border-border bg-surface p-0 transition-colors duration-hover ease-standard hover:border-accent"
            @click="opened = row"
            :aria-label="t('gallery.tileShow', { name: row.name })"
          >
            <img
              class="max-h-full max-w-full object-contain"
              :src="thumbnailUrl(row.name)"
              :alt="row.name"
              loading="lazy"
            />
          </button>
          <!-- A Wallpaper with no local file is a state, not a fault: a local
               placeholder, never a broken image and never a fetch to the CDN
               (spec decision 25; #35 AC 5). -->
          <div
            v-else
            class="grid h-[10rem] w-full place-items-center overflow-hidden rounded-sm border border-dashed border-border bg-surface p-0 text-[0.8rem] text-muted"
            role="img"
            :aria-label="t('gallery.tileNotOnDisk', { name: row.name })"
          >
            <span>{{ t('gallery.notOnDisk') }}</span>
          </div>
          <p class="mt-1 flex justify-between gap-2 text-[0.8rem]">
            <strong>{{ row.id ?? '—' }}</strong>
            <span :class="STATE_TONES[row.state]">{{ t(STATE_LABEL_KEYS[row.state]) }}</span>
          </p>
          <code class="text-xs break-all">{{ row.name }}</code>
        </li>
      </ul>
    </template>
    <FullSizeView
      v-if="opened !== null"
      :id="opened.id"
      :name="opened.name"
      @close="opened = null"
    />
  </section>
</template>
