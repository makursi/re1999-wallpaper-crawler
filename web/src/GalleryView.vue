<script setup lang="ts">
import { onMounted, ref } from 'vue'

import type { ConsoleGalleryPayload, ConsoleGalleryRowState } from '../../src/console/api-types.js'

const gallery = ref<ConsoleGalleryPayload | null>(null)
const failure = ref<string | null>(null)

/** The token this page was opened with; the service wants it on every request. */
function consoleToken(): string {
  return new URLSearchParams(window.location.search).get('token') ?? ''
}

async function loadGallery(): Promise<void> {
  try {
    const response = await fetch(`/api/gallery?token=${encodeURIComponent(consoleToken())}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    // The service's own payload; its shape is declared once, in
    // src/console/api-types.ts, and imported here as a type only.
    gallery.value = (await response.json()) as ConsoleGalleryPayload
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => {
  void loadGallery()
})

/**
 * The states as the page reads them. A gallery entry the list does not contain
 * carries no id, so its first column is a dash rather than a made-up number.
 */
const STATE_LABELS: Record<ConsoleGalleryRowState, string> = {
  'on-disk': 'on disk',
  missing: 'missing',
  'not-in-gallery': 'not in the gallery',
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
      <table>
        <thead>
          <tr>
            <th>Gallery id</th>
            <th>File name</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in gallery.rows" :key="`${row.id ?? 'no-id'} ${row.name}`">
            <td>{{ row.id ?? '—' }}</td>
            <td>
              <code>{{ row.name }}</code>
            </td>
            <td :class="row.state">{{ STATE_LABELS[row.state] }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
section {
  margin-top: 2rem;
}

h2 {
  font-size: 1.25rem;
}

table {
  border-collapse: collapse;
  width: 100%;
}

th,
td {
  border-bottom: 1px solid #ddd;
  padding: 0.35rem 0.5rem;
  text-align: left;
}

td.missing,
td.not-in-gallery {
  color: #a33;
}

code {
  font-size: 0.85rem;
  word-break: break-all;
}
</style>
