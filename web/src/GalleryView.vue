<script setup lang="ts">
import { onMounted, ref } from 'vue'

import type { ConsoleGalleryPayload, ConsoleGalleryRow } from '../api-types.js'
import { consoleToken } from './console-token'
import FullSizeView from './FullSizeView.vue'

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

/** The states as the page reads them. */
const STATE_LABELS: Record<ConsoleGalleryRow['state'], string> = {
  'on-disk': 'on disk',
  missing: 'missing',
  'not-in-gallery': 'not in the gallery',
}

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
  <section>
    <h2>Gallery</h2>
    <p v-if="failure !== null">{{ failure }}</p>
    <p v-else-if="gallery === null">Reading the Gallery list…</p>
    <template v-else>
      <p>
        The Gallery list holds
        <strong>{{ gallery.officialTotal === null ? 'not read' : gallery.officialTotal }}</strong>
        entries; the Mirror holds <strong>{{ gallery.mirrorCount }}</strong> files.
        <template v-if="gallery.newSinceLastRun !== null">
          The newest Run added <strong>{{ gallery.newSinceLastRun }}</strong
          >.
        </template>
      </p>
      <p v-if="!gallery.listAvailable">
        The Gallery list was not read, so this view shows the Mirror's files alone: nothing can be
        said about which Wallpapers are missing, and nothing here is a count of them.
      </p>
      <p v-else-if="gallery.mirrorGap !== null">
        {{ gallery.mirrorGap.missing }} listed Wallpapers are missing from the Mirror;
        {{ gallery.mirrorGap.extra }} Mirror files are not in the gallery any more.
      </p>
      <ul class="grid">
        <li v-for="row in gallery.rows" :key="rowKey(row)">
          <button
            v-if="isViewable(row)"
            type="button"
            class="tile"
            @click="opened = row"
            :aria-label="`Show ${row.name} at full size`"
          >
            <img :src="thumbnailUrl(row.name)" :alt="row.name" loading="lazy" />
          </button>
          <!-- A Wallpaper with no local file is a state, not a fault: a local
               placeholder, never a broken image and never a fetch to the CDN
               (spec decision 25; #35 AC 5). -->
          <div
            v-else
            class="tile placeholder"
            role="img"
            :aria-label="`${row.name} is not on disk`"
          >
            <span>not on disk</span>
          </div>
          <p class="meta">
            <strong>{{ row.id ?? '—' }}</strong>
            <span :class="row.state">{{ STATE_LABELS[row.state] }}</span>
          </p>
          <code>{{ row.name }}</code>
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

<style scoped>
section {
  margin-top: 2rem;
}

h2 {
  font-size: 1.25rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: 0.75rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}

.grid li {
  margin: 0;
}

.tile {
  display: grid;
  width: 100%;
  height: 10rem;
  place-items: center;
  padding: 0;
  border: 1px solid #ddd;
  border-radius: 0.3rem;
  background: #f6f7f9;
  cursor: pointer;
  overflow: hidden;
}

.tile img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.placeholder {
  border-style: dashed;
  color: #777;
  cursor: default;
  font-size: 0.8rem;
}

.meta {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0.3rem 0 0;
  font-size: 0.8rem;
}

.meta .missing,
.meta .not-in-gallery {
  color: #a33;
}

code {
  font-size: 0.75rem;
  word-break: break-all;
}
</style>
