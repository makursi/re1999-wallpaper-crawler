<script setup lang="ts">
// ── The navigation pill ─────────────────────────────────────────────
//
// The floating glass navigation the page shell floats on (#48): the product
// name, the one number worth having at a glance, the way into the Run panel,
// the language switch, and the version this build is (#79).
//
// The blur filter appears exactly once, on this pill, which is fixed. It is
// never used on content that scrolls: a blurred scrolling surface is the one
// gesture the design system refuses.

import { DialogTrigger } from 'reka-ui'

import { useConsoleStatus } from '../composables/useConsoleStatus'
import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'
import LocaleSwitch from './LocaleSwitch.vue'

// The nav's Mirror count and the drawer's Run facts are one fact, so they come
// from one store: `composables/useConsoleStatus.ts` holds the page's single read
// of `/api/status`, and the count above the wall follows the Run poll.
const { status } = useConsoleStatus()
</script>

<template>
  <!-- The floating glass pill. Fixed, so this is the one layer allowed a
       blur; not edge to edge, so it reads as something lying on the page.
       The entrance is the site's own register — two rem up, fading in, on
       the token's curve and duration — and it collapses under
       `prefers-reduced-motion` with every other duration. -->
  <div class="fixed inset-x-0 top-5 z-20 flex justify-center px-4">
    <header
      class="flex animate-rise-in flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-pill border border-border bg-glass px-4 py-2 backdrop-blur-md"
    >
      <h1 class="flex items-center gap-2 font-serif text-lg font-bold">
        <span class="i-ph-image-light text-xl" aria-hidden="true" />
        {{ t('app.title') }}
      </h1>

      <span class="h-5 w-px bg-border" aria-hidden="true" />

      <!-- The one number worth having at a glance: how much is in the Mirror.
           A data cell, so it takes the numeral role like every other count. -->
      <p class="numeric text-sm text-secondary">
        <Message
          v-if="status !== null"
          message="nav.mirrorCount"
          :params="{ count: status.mirrorCount }"
        />
        <template v-else>{{ t('app.readingMirror') }}</template>
      </p>

      <span class="h-5 w-px bg-border" aria-hidden="true" />

      <DialogTrigger as-child>
        <button
          type="button"
          class="flex cursor-pointer items-center gap-1 rounded-pill border border-transparent px-3 py-1 text-sm transition-colors duration-hover ease-standard hover:border-accent"
        >
          <!-- Navigation weight: the light Phosphor stroke, never the regular
               weight the dense data and the controls take. -->
          <span class="i-ph-sliders-horizontal-light" aria-hidden="true" />
          {{ t('nav.run') }}
        </button>
      </DialogTrigger>

      <LocaleSwitch />

      <span class="h-5 w-px bg-border" aria-hidden="true" />

      <!-- The number to quote when reporting a problem (#79): which build this
           page is. Quiet, because it is reference rather than status, but on
           the fixed pill so it is always in view; the value is a data cell. -->
      <p v-if="status?.version" class="text-xs text-muted">
        <Message message="nav.version" :params="{ version: status.version }" />
      </p>
    </header>
  </div>
</template>
