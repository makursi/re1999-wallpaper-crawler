<script setup lang="ts">
import { onMounted, ref } from 'vue'

import type { ConsoleStatusPayload } from '../api-types.js'
import { consoleToken } from './console-token'
import GalleryView from './GalleryView.vue'
import { locale, setLocale, t } from './i18n/locale'
import Message from './i18n/Message.vue'
import { LOCALES } from './i18n/messages'
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
       no scoped `<style>` element left, and no colour or spacing literal
       either. The mark is a Phosphor icon in its light weight (the heading is
       the page's one large mark); its strokes stay finer than the dense data's
       regular weight, which is the rule this page follows for icons.

       Page copy is not written here: it is a dictionary key, looked up in the
       locale in force (web/src/i18n/messages.ts), and a message that
       interpolates a value renders through `Message.vue` so that value keeps
       the numeral role. The language switch sits in the header area, beside the
       page's name; ticket #48 moves it into the floating nav it is planning,
       and this is the header the rework starts from.

       The type roles are applied the same way (#49): the page's one heading
       takes `font-serif` (the Chinese heading role, whose Latin display face
       leads its stack) and the count below takes `numeric`, the numeral role in
       one class. The body is `font-sans`, which is also the reset's own base
       face. -->
  <main class="mx-auto my-8 max-w-[40rem] font-sans">
    <header class="flex items-baseline justify-between gap-3">
      <h1 class="font-serif text-xl font-bold">
        <span class="i-ph-image-light mr-1" aria-hidden="true" />
        {{ t('app.title') }}
      </h1>
      <div class="flex items-center gap-1" role="group" :aria-label="t('language.label')">
        <button
          v-for="option in LOCALES"
          :key="option"
          type="button"
          class="flex-none cursor-pointer rounded-sm border border-border bg-surface-raised px-[0.6rem] py-[0.3rem] text-sm transition-colors duration-hover ease-standard hover:border-accent"
          :class="option === locale ? 'border-accent text-primary' : 'text-muted'"
          :aria-pressed="option === locale"
          @click="setLocale(option)"
        >
          <!-- Each language names itself in its own language: a switch that
               says 中文 only in Chinese is useless to the reader who needs it. -->
          {{ t(option === 'zh-CN' ? 'language.chinese' : 'language.english') }}
        </button>
      </div>
    </header>
    <p v-if="failure !== null" class="text-2xl">{{ failure }}</p>
    <p v-else-if="status === null" class="text-2xl">{{ t('app.readingMirror') }}</p>
    <p v-else class="text-2xl">
      <Message message="app.wallpapersInMirror" :params="{ count: status.mirrorCount }" />
    </p>
    <RunPanel />
    <GalleryView />
  </main>
</template>
