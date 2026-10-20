<script setup lang="ts">
// The fullscreen viewer (#35, restyled #48): one Wallpaper, served from the
// Mirror by `/api/image/<name>` — the original file, never a second derived
// size. The overlay is the only place the gallery's own id and the file name
// are shown together, so a page can be read against a Run report.
//
// The dialog behaviour is reka-ui's, not this file's (#45): Escape, the focus
// trap, the outside-click dismissal, `role="dialog"` and the focus return to
// the tile that opened it are the primitive's. This component is the *content*
// — it deliberately has no `DialogRoot` of its own, because the root belongs
// beside the wall it opens from (`GalleryView.vue`), which is what makes the
// tile a real `DialogTrigger` and gives the primitive a trigger to hand focus
// back to.
//
// The one thing the primitive does not do is `aria-modal` (#48's verified
// defect): reka-ui marks the dialog `role="dialog"` and hides the rest of the
// document, but sets no `aria-modal`, so the attribute is stated here.

import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  VisuallyHidden,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'

import { consoleToken } from './console-token'
import { t } from './i18n/locale'
import Message from './i18n/Message.vue'
import { withQueryToken } from './lib/console-api'

const props = defineProps<{
  /** The gallery's own id; `null` for a Mirror file the list no longer holds. */
  id: number | null
  name: string
}>()

const emit = defineEmits<{ close: [] }>()

/**
 * The zoom ladder, as factors of the height-fitted image. Discrete steps rather
 * than a free scale: the control is three buttons and a readout, and a wall of
 * artwork is read at a few useful magnifications, not at 137%.
 */
const ZOOM_STEPS = [1, 1.25, 1.5, 2, 3, 4]

const step = ref(0)

/** The scale the image is painted at; `1` is the fitted view. */
const zoom = computed(() => ZOOM_STEPS[step.value])
const percent = computed(() => Math.round(zoom.value * 100))
const canZoomOut = computed(() => step.value > 0)
const canZoomIn = computed(() => step.value < ZOOM_STEPS.length - 1)
const fitted = computed(() => step.value === 0)

function zoomOut(): void {
  step.value = Math.max(step.value - 1, 0)
}

function zoomIn(): void {
  step.value = Math.min(step.value + 1, ZOOM_STEPS.length - 1)
}

function resetZoom(): void {
  step.value = 0
}

/** A click on the picture is the same gesture the `+` control makes. */
function zoomInFromPicture(): void {
  if (canZoomIn.value) zoomIn()
}

function imageUrl(): string {
  // The client module is the one place a request path carries the token; this
  // view only says *which* file it wants to see.
  return withQueryToken(`/api/image/${encodeURIComponent(props.name)}`, consoleToken())
}

// A failed original (a file that vanished mid-view) is stated rather than
// turned into a broken image.
const failure = ref(false)

// A new Wallpaper opens at the fitted view: the zoom a previous image was left
// at is that image's, not this one's.
watch(
  () => props.name,
  () => {
    step.value = 0
    failure.value = false
  },
)

/**
 * The primitive closes on Escape, on a click outside and on the close button;
 * every one of those arrives here as the root's `open` turning false, and the
 * page's own state is what ends the view.
 */
function onOpenChange(open: boolean): void {
  if (!open) emit('close')
}
</script>

<template>
  <!-- The scrim is the site's own 80% black, and it fades with the content: the
       two are one gesture, so they share a duration and a curve. Neither uses
       the blur filter — this layer sits over a page that is not scrolling
       under it, and the design system allows the filter on floating chrome
       only. -->
  <DialogPortal>
    <DialogOverlay
      class="fixed inset-0 z-30 bg-scrim data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
    />
    <!-- `role="dialog"` comes from the primitive; `aria-modal` does not, so it
         is stated — a screen reader has to be told the page behind this layer
         is inert, which `aria-hidden` alone does not say.
         `@click.self` is the outside click: this layer covers the viewport (the
         picture fits inside its padding, the scrim is behind everything), so
         the primitive's own outside detection never fires. -->
    <DialogContent
      class="fixed inset-0 z-30 m-0 flex max-h-none max-w-none items-center justify-center border-0 bg-transparent p-8 data-[state=closed]:animate-rise-out data-[state=open]:animate-rise-in"
      aria-modal="true"
      @click.self="emit('close')"
    >
      <!-- The dialog's accessible name and description. The control pill below
           says the same id visually; this pair is what a screen reader
           announces, so both are hidden. -->
      <VisuallyHidden>
        <DialogTitle>{{ name }}</DialogTitle>
        <DialogDescription>
          <Message message="viewer.galleryId" :params="{ id: id ?? '—' }" />
        </DialogDescription>
      </VisuallyHidden>

      <!-- Fit to the layer inside its padding, and uncropped: the picture is
           `object-contain` within the padded box, and the zoom is a scale about
           that fitted size — no second derived file is ever requested. -->
      <img
        class="max-h-full max-w-full object-contain transition-transform duration-enter ease-out-expo"
        :class="canZoomIn ? 'cursor-zoom-in' : 'cursor-zoom-out'"
        :style="{ transform: `scale(${zoom})` }"
        :src="imageUrl()"
        :alt="name"
        @error="failure = true"
        @click="zoomInFromPicture"
      />

      <p v-if="failure" class="absolute top-8 text-danger text-sm">
        {{ t('viewer.missingFile') }}
      </p>

      <!-- The controls: a rounded surface pill floating at the bottom of the
           layer. The readout is a data cell, so it takes the numeral role the
           same way every count on the page does.
           `z-10` because the picture scales (a `transform` makes it a stacking
           context) and would otherwise paint over the pill it is meant to sit
           behind — observed at 100% zoom, where the image covers the middle of
           the pill while its two ends stay visible. -->
      <div class="absolute inset-x-0 bottom-6 z-10 flex justify-center">
        <div class="flex items-center gap-1 rounded-pill bg-surface px-2 py-1 text-primary">
          <button
            type="button"
            class="cursor-pointer rounded-sm p-2 transition-colors duration-hover ease-standard hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canZoomOut"
            :aria-label="t('viewer.zoomOut')"
            :title="t('viewer.zoomOut')"
            @click="zoomOut"
          >
            <span class="i-ph-minus" aria-hidden="true" />
          </button>
          <span class="numeric min-w-[4.5rem] text-center text-sm">
            <Message message="viewer.zoomPercent" :params="{ percent }" />
          </span>
          <button
            type="button"
            class="cursor-pointer rounded-sm p-2 transition-colors duration-hover ease-standard hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canZoomIn"
            :aria-label="t('viewer.zoomIn')"
            :title="t('viewer.zoomIn')"
            @click="zoomIn"
          >
            <span class="i-ph-plus" aria-hidden="true" />
          </button>
          <span class="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            class="cursor-pointer rounded-sm p-2 transition-colors duration-hover ease-standard hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="fitted"
            :aria-label="t('viewer.reset')"
            :title="t('viewer.reset')"
            @click="resetZoom"
          >
            <span class="i-ph-arrow-counter-clockwise" aria-hidden="true" />
          </button>
          <DialogClose as-child>
            <button
              type="button"
              class="flex cursor-pointer items-center gap-1 rounded-sm px-3 py-2 transition-colors duration-hover ease-standard hover:text-accent-hover"
            >
              <span class="i-ph-x" aria-hidden="true" />
              <!-- The close control keeps the words: it is the one control a
                   keyboard user reaches for by name. -->
              <span class="text-sm">{{ t('viewer.close') }}</span>
            </button>
          </DialogClose>
        </div>
      </div>
    </DialogContent>
  </DialogPortal>
</template>
