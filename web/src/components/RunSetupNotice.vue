<script setup lang="ts">
import { useConsoleStatus } from '../composables/useConsoleStatus'
import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'

const { status } = useConsoleStatus()
</script>

<template>
  <!-- The setup notice (#60). With no usable `.env` the start control would be
       refused, so the panel says what to create before any click: the file at
       the repository root (a data cell, hence `Message.vue`) and the two site
       constants it needs, which are the same two lines README.md gives. It is
       guidance, not an error: the danger role belongs to the refusal the click
       returns, which names the same `env-file` prerequisite. The Console never
       writes the file — the reader does. -->
  <aside
    v-if="status !== null && !status.runConfigAvailable"
    class="mt-3 rounded-sm border border-border bg-surface-raised p-3"
  >
    <h3 class="font-serif font-bold">{{ t('run.setup.heading') }}</h3>
    <p class="mt-1 text-sm">{{ t('run.setup.body') }}</p>
    <p class="mt-2 text-sm">
      <Message message="run.setup.file" :params="{ file: '.env' }" />
    </p>
    <pre
      class="numeric mt-2 overflow-x-auto rounded-sm border border-border bg-base p-2 text-xs leading-relaxed"
      >{{ t('run.setup.lines') }}</pre>
    <p class="mt-2 text-muted text-sm">{{ t('run.setup.note') }}</p>
  </aside>
</template>
