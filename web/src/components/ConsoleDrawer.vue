<script setup lang="ts">
// ── The drawer ──────────────────────────────────────────────────────
//
// The Run panel and the Orphan panel, as a side layer (#48). The panel is four
// lines now (#97): the verdict, `ok N · failed N`, the figures line the wall's
// header prints, and at most one problem line — plus the start control and the
// orphan cleanup. The run id, the Discovery counters, the success rate, the
// defect rows and the routine notes went with the log dump they belonged to.

import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  VisuallyHidden,
} from 'reka-ui'

import { useConsoleStatus } from '../composables/useConsoleStatus'
import { t } from '../i18n/locale'
import RunPanel from '../RunPanel.vue'

const { failure, refresh } = useConsoleStatus()
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      class="fixed inset-0 z-30 bg-scrim data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
    />
    <DialogContent
      class="fixed top-0 right-0 z-30 flex h-full w-[27rem] max-w-[92vw] flex-col gap-5 overflow-y-auto border-border border-l bg-surface p-6 data-[state=closed]:animate-slide-out-right data-[state=open]:animate-slide-in-right"
      aria-modal="true"
    >
      <VisuallyHidden>
        <DialogTitle>{{ t('drawer.title') }}</DialogTitle>
      </VisuallyHidden>

      <div class="flex items-center justify-between gap-3">
        <h2 class="font-serif text-lg font-bold">{{ t('drawer.title') }}</h2>
        <DialogClose as-child>
          <button
            type="button"
            class="flex cursor-pointer items-center gap-1 rounded-pill border border-transparent px-3 py-1 text-sm transition-colors duration-hover ease-standard hover:border-accent"
          >
            <span class="i-ph-x" aria-hidden="true" />
            {{ t('drawer.close') }}
          </button>
        </DialogClose>
      </div>

      <!-- A status read that failed is stated where the panel it belongs to
           is: one plain sentence and a retry (#83), never the raw status code
           a transport happens to have answered with. -->
      <div v-if="failure !== null" class="flex flex-col items-start gap-2">
        <p class="text-danger text-sm">{{ t('console.readFailed') }}</p>
        <button type="button" class="action-button px-3 py-1 text-sm" @click="refresh">
          <span class="i-ph-arrow-clockwise mr-1" aria-hidden="true" />{{ t('action.retry') }}
        </button>
      </div>

      <RunPanel />
    </DialogContent>
  </DialogPortal>
</template>
