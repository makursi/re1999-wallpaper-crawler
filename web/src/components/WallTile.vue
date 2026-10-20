<script setup lang="ts">
import { DialogTrigger } from 'reka-ui'

import type { ConsoleGalleryRow } from '../../api-types.js'
import { t } from '../i18n/locale'
import { GALLERY_ROW_STATE_MESSAGE_KEYS } from '../i18n/messages'

defineProps<{
  /** The row this tile stands for. */
  row: ConsoleGalleryRow
  /** The aspect-ratio box it reserves, measured from the Mirror. */
  box: string
  /** Its cache-backed thumbnail URL, with the token on it. */
  thumbnailUrl: string
}>()
defineEmits<{ open: [row: ConsoleGalleryRow] }>()

/**
 * The tone a state that has no image reads in. `missing` is the fault — the
 * official list names a Wallpaper the Mirror does not hold — while
 * `not-in-gallery` is the list having moved on; the two are different
 * statements, so they are not the same colour.
 */
const STATE_TONES: Record<ConsoleGalleryRow['state'], string> = {
  'on-disk': 'text-secondary',
  missing: 'text-danger',
  'not-in-gallery': 'text-warning',
}
</script>

<template>
  <!-- A tile is square-cornered, shadowless and carries its 1px border
       from the start — transparent until hover, so the rust hairline
       costs no layout at all. -->
  <DialogTrigger v-if="row.viewable" as-child>
    <button
      type="button"
      class="block w-full cursor-pointer overflow-hidden border border-transparent bg-surface p-0 transition-colors duration-hover ease-standard hover:border-accent focus-visible:border-accent focus-visible:outline-none"
      :style="{ aspectRatio: box }"
      :aria-label="t('gallery.tileShow', { name: row.name })"
      @click="$emit('open', row)"
    >
      <img
        class="block h-full w-full object-contain"
        :src="thumbnailUrl"
        :alt="row.name"
        loading="lazy"
        decoding="async"
      />
    </button>
  </DialogTrigger>
  <!-- A Wallpaper with no local file is a state, not a fault: a local
       placeholder, never a broken image and never a fetch to the CDN
       (spec decision 25; #35 AC 5). It keeps the row's own name, so
       the identifier stays readable for a tile that cannot be
       opened. -->
  <div
    v-else
    class="grid w-full place-content-center gap-1 overflow-hidden border border-dashed border-border bg-surface p-2 text-center text-xs"
    role="img"
    :style="{ aspectRatio: box }"
    :aria-label="t('gallery.tileNotOnDisk', { name: row.name })"
  >
    <span class="i-ph-image-light mx-auto text-xl text-muted" aria-hidden="true" />
    <span :class="STATE_TONES[row.state]">{{ t(GALLERY_ROW_STATE_MESSAGE_KEYS[row.state]) }}</span>
    <code class="break-all text-[0.7rem] text-muted">{{ row.name }}</code>
  </div>
</template>
