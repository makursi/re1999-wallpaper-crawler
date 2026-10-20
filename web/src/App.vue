<script setup lang="ts">
// ── The page's shell (#48) ──────────────────────────────────────────
//
// A print catalogue of wallpapers. The wall is the page (`GalleryView.vue`);
// this file is everything around it: the floating glass navigation, the 100px
// scrim it floats on, and the drawer the Run panel and the Orphan panel moved
// into so they stop pushing the wall down.
//
// The atmosphere is not here, and not an image: `web/uno.config.ts`'s preflight
// paints the amber glow and the 3% grain on two fixed, `pointer-events: none`
// pseudo-elements of the body, because it is a property of the page and not of
// any one element. No asset from the gallery enters the repository — the same
// rule that keeps its fonts and its logo out (spec #43, docs/adr/0013).
//
// The blur filter appears exactly once, on the navigation pill, which is fixed.
// It is never used on content that scrolls: a blurred scrolling surface is the
// one gesture the design system refuses.

import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  VisuallyHidden,
} from 'reka-ui'
import { ref } from 'vue'

import { useConsoleStatus } from './composables/useConsoleStatus'
import GalleryView from './GalleryView.vue'
import { locale, setLocale, t } from './i18n/locale'
import Message from './i18n/Message.vue'
import { LOCALES } from './i18n/messages'
import RunPanel from './RunPanel.vue'

// The nav's Mirror count and the drawer's Run facts are one fact, so they come
// from one store: `composables/useConsoleStatus.ts` holds the page's single read
// of `/api/status`, and the count above the wall follows the Run poll.
const { status, failure } = useConsoleStatus()
const drawerOpen = ref(false)
</script>

<template>
  <!-- The site's own bottom-fading black scrim, at its own 100px: the pill
       floats on a fade rather than on a bar, so a long wall is never cut in
       two by its navigation. -->
  <div
    class="pointer-events-none fixed inset-x-0 top-0 z-10 h-[100px]"
    style="background-image: var(--token-nav-scrim)"
    aria-hidden="true"
  />

  <DialogRoot :open="drawerOpen" @update:open="drawerOpen = $event">
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

        <div class="flex items-center gap-1" role="group" :aria-label="t('language.label')">
          <button
            v-for="option in LOCALES"
            :key="option"
            type="button"
            class="flex-none cursor-pointer rounded-pill border border-transparent px-3 py-1 text-sm transition-colors duration-hover ease-standard hover:border-accent"
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
    </div>

    <!-- The wall, on the page's own 7vw edge. -->
    <main class="px-page pt-28 font-sans">
      <GalleryView />
    </main>

    <!-- The Run panel and the Orphan panel, as a side layer. Every fact they
         showed while they sat in the flow is still here — the run id, the
         verdict and its reasons, the Gallery and Download numbers, the defect
         rows, the start control and the orphan cleanup — because nothing was
         dropped in the move, only moved. -->
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

        <!-- A status read that failed is a runtime message, not copy, and it is
             stated where the panel it belongs to is. -->
        <p v-if="failure !== null" class="text-danger text-sm">{{ failure }}</p>

        <RunPanel />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
