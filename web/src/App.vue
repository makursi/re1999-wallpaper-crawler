<script setup lang="ts">
import { onMounted, ref } from 'vue'

import type { ConsoleStatusPayload } from '../api-types.js'
import { consoleToken } from './console-token'
import GalleryView from './GalleryView.vue'
import RunPanel from './RunPanel.vue'

const status = ref<ConsoleStatusPayload | null>(null)
const failure = ref<string | null>(null)

async function loadStatus(): Promise<void> {
  try {
    const response = await fetch(`/api/status?token=${encodeURIComponent(consoleToken())}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    // The service's own payload; its shape is declared once, in
    // web/api-types.ts, and imported here as a type only.
    status.value = (await response.json()) as ConsoleStatusPayload
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => {
  void loadStatus()
})
</script>

<template>
  <main>
    <h1>Console</h1>
    <p v-if="failure !== null">{{ failure }}</p>
    <p v-else-if="status === null">Reading the Mirror…</p>
    <p v-else>{{ status.mirrorCount }} Wallpapers in the Mirror</p>
    <RunPanel />
    <GalleryView />
  </main>
</template>

<style scoped>
main {
  margin: 2rem auto;
  max-width: 40rem;
  font-family: system-ui, sans-serif;
}

h1 {
  font-size: 1.25rem;
}

p {
  font-size: 1.5rem;
}
</style>
