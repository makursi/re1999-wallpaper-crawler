<script setup lang="ts">
// The full-size view (#35): one Wallpaper, served from the Mirror by
// `/api/image/<name>` — the original file, never a second derived size. The
// overlay is the only place the gallery's own id and the file name are shown
// together, so a page can be read against a Run report.
//
// The dialog behaviour is reka-ui's, not this file's (#45): Escape, the focus
// trap, the outside-click dismissal, the `role="dialog"` and `aria-modal`
// wiring, and the focus return to the tile that opened it are all the
// primitive's. What is left here is the markup, the copy and the classes.

import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  VisuallyHidden,
} from 'reka-ui'
import { ref } from 'vue'

import { consoleToken } from './console-token'

const props = defineProps<{
  /** The gallery's own id; `null` for a Mirror file the list no longer holds. */
  id: number | null
  name: string
}>()

const emit = defineEmits<{ close: [] }>()

function imageUrl(): string {
  return `/api/image/${encodeURIComponent(props.name)}?token=${encodeURIComponent(consoleToken())}`
}

// A failed original (a file that vanished mid-view) is stated rather than
// turned into a broken image.
const failure = ref(false)

/**
 * The primitive closes on Escape, on an outside click and on the close button;
 * every one of those arrives here as `open` turning false, and the page's own
 * state is what actually unmounts the view.
 */
function onOpenChange(open: boolean): void {
  if (!open) emit('close')
}
</script>

<template>
  <DialogRoot :open="true" @update:open="onOpenChange">
    <DialogPortal>
      <!-- The fixed scrim. No blur filter is used here: none is allowed on
           scrolling content and this overlay is not restyled until #48, so
           today's look has none. -->
      <DialogOverlay class="fixed inset-0 z-10 bg-scrim" />
      <!-- `as-child` keeps the figure: the primitive's props and listeners merge
           onto it, so the dialog element is the same element it always was. -->
      <DialogContent
        as-child
        class="fixed left-1/2 top-1/2 z-10 m-0 flex max-h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] max-w-[70rem] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-md bg-surface p-3"
      >
        <figure>
          <!-- The dialog's accessible name and description. The caption below
               says the same thing visually; this pair is what a screen reader
               announces, so both are hidden. -->
          <VisuallyHidden>
            <DialogTitle>{{ name }}</DialogTitle>
            <DialogDescription>Gallery id {{ id ?? '—' }}</DialogDescription>
          </VisuallyHidden>
          <img
            class="max-h-[80vh] max-w-full object-contain"
            :src="imageUrl()"
            :alt="name"
            @error="failure = true"
          />
          <figcaption class="flex items-baseline gap-3 text-sm text-primary">
            <span
              >Gallery id <strong>{{ id ?? '—' }}</strong></span
            >
            <code class="min-w-0 flex-1 truncate text-secondary">{{ name }}</code>
            <DialogClose as-child>
              <!-- The small-control weight: a regular Phosphor stroke, never
                   the light weight the page's heading mark uses. -->
              <button
                type="button"
                class="flex-none cursor-pointer rounded-sm border border-border bg-surface-raised px-[0.6rem] py-[0.3rem] transition-colors duration-hover ease-standard hover:border-accent"
              >
                <span class="i-ph-x mr-1" aria-hidden="true" />Close (Esc)
              </button>
            </DialogClose>
          </figcaption>
          <p v-if="failure" class="text-sm text-danger">That file is no longer in the Mirror.</p>
        </figure>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
