<script setup lang="ts">
// ── The one line that says a newer release exists (#81) ─────────────
//
// One line, one link, no modal and no prompt. The whole line is the anchor to
// the project's Releases page — the reader fetches the zip themselves; the
// Console never downloads, replaces or asks. The version is a data cell, so it
// goes through `Message` like every other value inside a sentence (ADR 0014),
// and the parent decides whether there is a notice to render at all.

import type { ConsoleUpdateNotice } from '../../api-types.js'
import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'

defineProps<{
  /** The boot check's answer; a null notice is the parent's not to render. */
  notice: ConsoleUpdateNotice
}>()
</script>

<template>
  <a
    :href="notice.releasesUrl"
    target="_blank"
    rel="noreferrer noopener"
    class="flex items-center gap-1 text-xs text-muted transition-colors duration-hover ease-standard hover:text-accent"
  >
    <Message message="update.available" :params="{ version: notice.version }" />
    <span aria-hidden="true">·</span>
    {{ t('update.releases') }}
    <span class="i-ph-arrow-up-right-light" aria-hidden="true" />
  </a>
</template>
