<script setup lang="ts">
import { DialogTrigger } from 'reka-ui'

import type { ConsoleGalleryRow } from '../../api-types.js'
import { t } from '../i18n/locale'

defineProps<{
  /** The row this tile stands for — a Wallpaper really on disk (#94). */
  row: ConsoleGalleryRow
  /** The aspect-ratio box it reserves, measured from the Mirror. */
  box: string
  /** Its cache-backed thumbnail URL, with the token on it. */
  thumbnailUrl: string
}>()
defineEmits<{ open: [row: ConsoleGalleryRow] }>()
</script>

<template>
  <!-- Every row is a Wallpaper the Mirror holds, so every tile has a file to
       show: there is no placeholder state, no "not on disk" and no thumbnail
       request for a name that is not there (#94). A tile is square-cornered,
       shadowless and carries its 1px border from the start — transparent until
       hover, so the rust hairline costs no layout at all. -->
  <DialogTrigger as-child>
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
</template>
