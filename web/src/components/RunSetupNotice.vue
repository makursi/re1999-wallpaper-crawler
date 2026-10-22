<script setup lang="ts">
import { useConsoleStatus } from '../composables/useConsoleStatus'
import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'

const { status } = useConsoleStatus()
</script>

<template>
  <!-- The setup notice (#60, #95). It renders only while the configuration is
       really unusable: `runConfigAvailable` is read off the same `.env`
       predicate the start's `env-file` refusal uses, so a usable configuration
       renders nothing at all — and a Portable package, whose `app\.env` is
       generated, never sees this. Two lines and no more: why a Run cannot start,
       then the line to write. The file is the `.env` beside the program, not
       "the repository root", which a Portable package does not have; the name is
       a data cell, hence `Message.vue`. Nothing says "refresh the page": opening
       the drawer or returning to the window re-reads the status (#95), so
       creating the file clears the notice itself. It is guidance, not an error:
       the danger role belongs to the refusal a click returns, which names the
       same `env-file` prerequisite. The Console never writes the file — the
       reader does. -->
  <aside
    v-if="status?.runConfigAvailable === false"
    class="mt-3 rounded-sm border border-border bg-surface-raised p-3"
  >
    <p class="text-sm">
      <Message message="run.setup.body" :params="{ file: '.env' }" />
    </p>
    <pre
      class="numeric mt-2 overflow-x-auto rounded-sm border border-border bg-base p-2 text-xs leading-relaxed"
      >{{ t('run.setup.lines') }}</pre>
  </aside>
</template>
