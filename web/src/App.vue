<script setup lang="ts">
// ── The page's shell (#48) ──────────────────────────────────────────
//
// A print catalogue of wallpapers. The wall is the page (`GalleryView.vue`);
// this file is everything around it: the floating glass navigation, the 100px
// scrim it floats on, and the drawer the Run panel and the Orphan panel moved
// into so they stop pushing the wall down. The navigation, the language switch
// and the drawer's content are their own components (`web/src/components/`), so
// this file reads as the shell's structure rather than as its transcript.
//
// The atmosphere is not here, and not an image: `web/uno.config.ts`'s preflight
// paints the amber glow and the 3% grain on two fixed, `pointer-events: none`
// pseudo-elements of the body, because it is a property of the page and not of
// any one element. No asset from the gallery enters the repository — the same
// rule that keeps its fonts and its logo out (spec #43, docs/adr/0013).

import { DialogRoot } from 'reka-ui'
import { ref, watch } from 'vue'

import ConsoleDrawer from './components/ConsoleDrawer.vue'
import ConsoleNav from './components/ConsoleNav.vue'
import { useConsoleStatus } from './composables/useConsoleStatus'
import GalleryView from './GalleryView.vue'

const drawerOpen = ref(false)

// Opening the drawer re-reads the status (#95): the reader who created the
// missing `.env` after the page loaded finds the setup notice already gone,
// with no reload. The drawer's click is the shell's fact, so the wiring is the
// shell's; the read itself stays the store's one read.
const { refresh } = useConsoleStatus()
watch(drawerOpen, open => {
  if (open) void refresh()
})
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
    <ConsoleNav />

    <!-- The wall, on the page's own 7vw edge. -->
    <main class="px-page pt-28 font-sans">
      <GalleryView />
    </main>

    <ConsoleDrawer />
  </DialogRoot>
</template>
