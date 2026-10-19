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
  <!-- Every class below is a semantic token or an UnoCSS atomic class; there is
       no `<style>` block left, and no colour or spacing literal either. The
       mark is a Phosphor icon in its light weight (the heading is the page's
       one large mark); its strokes stay finer than the dense data's regular
       weight, which is the rule this page follows for icons.

       The type roles are applied the same way: the page's one heading takes
       `font-serif` (the Chinese heading role, whose Latin display face leads its
       stack) and the count below takes `numeric`, the numeral role in one class.
       The body is `font-sans`, which is also the reset's own base face. -->
  <main class="mx-auto my-8 max-w-[40rem] font-sans">
    <h1 class="font-serif text-xl font-bold">
      <span class="i-ph-image-light mr-1" aria-hidden="true" />
      壁纸图鉴
    </h1>
    <p v-if="failure !== null" class="text-2xl">{{ failure }}</p>
    <p v-else-if="status === null" class="text-2xl">Reading the Mirror…</p>
    <p v-else class="text-2xl">
      <span class="numeric">{{ status.mirrorCount }}</span> Wallpapers in the Mirror
    </p>
    <RunPanel />
    <GalleryView />
  </main>
</template>
