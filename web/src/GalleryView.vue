<script setup lang="ts">
// ── The wall (#48) ──────────────────────────────────────────────────
//
// The gallery is the page's hero: five columns of Wallpapers, sorted into the
// shortest column, at their own proportions and uncropped. Everything else the
// page used to stack above it — the Run panel and the Orphan panel — lives in
// the drawer (`App.vue`), so this view is the wall and a one-band caption that
// reads it: what the list said, what the Mirror holds, and what the two
// disagree about.
//
// The layout is a pure function of the Mirror's own numbers. Each row carries
// the file's pixel size (`/api/gallery`'s `sizes`, measured by the service), so
// a tile's box is reserved before its lazy thumbnail arrives — which is what
// keeps the wall still while it loads, and what lets `web/src/lib/masonry.ts`
// balance the columns against real heights instead of guessing from whatever
// the browser happens to have loaded. A row the service could not measure falls
// back to a portrait placeholder box, which is a guess and is allowed to be one.
//
// The dialog belongs here rather than in the viewer: each tile is a
// `DialogTrigger`, which is what gives reka-ui a trigger to hand focus back to
// when the viewer closes (#48's first verified defect).

import { DialogRoot } from 'reka-ui'
import { computed, ref } from 'vue'

import type { ConsoleGalleryRow, ConsoleImageSize } from '../api-types.js'
import WallHeader from './components/WallHeader.vue'
import WallTile from './components/WallTile.vue'
import { useGallery } from './composables/useGallery'
import { consoleToken } from './console-token'
import FullSizeView from './FullSizeView.vue'
import { withToken } from './lib/console-api'
import { columnsOf } from './lib/masonry'

/**
 * The wall's columns. Five is the gallery's own measurement (spec #43: about
 * 314px a column at 1920, with 16px gutters and a 7vw page edge), and it is
 * fixed rather than responsive because the wall is the page: a narrower window
 * shows the same catalogue in narrower columns, which is what a contact sheet
 * does.
 */
const COLUMN_COUNT = 5

/** The box an unmeasured tile reserves: a 3:4 portrait, the shape most are. */
const PLACEHOLDER_BOX = '3 / 4'
/** The same guess as a height-to-width ratio, which is what the columns add up. */
const PLACEHOLDER_HEIGHT_RATIO = 4 / 3

// `/api/gallery` is read once, by the wall's own composable; the client it uses
// is the page's only place a request carries this start's token.
const { gallery, failure } = useGallery()

/** The tile the viewer is showing; kept after a close so the exit can finish. */
const shown = ref<ConsoleGalleryRow | null>(null)
/** Whether the viewer is open; `shown` deliberately outlives it (see above). */
const viewerOpen = ref(false)

/** The Mirror's measured size for a row, or `null` when there is not one. */
function measuredSize(row: ConsoleGalleryRow): ConsoleImageSize | null {
  const size = gallery.value?.sizes[row.name]
  return size !== undefined && size.width > 0 && size.height > 0 ? size : null
}

/** A tile's height-to-width ratio — what the columns are balanced against. */
function heightRatioOf(row: ConsoleGalleryRow): number {
  const size = measuredSize(row)
  return size === null ? PLACEHOLDER_HEIGHT_RATIO : size.height / size.width
}

/**
 * The box a tile reserves. The Mirror's own proportion when it was measurable,
 * so the image lands in a box it exactly fills; a portrait placeholder when it
 * was not, so the wall still has a shape.
 */
function boxOf(row: ConsoleGalleryRow): string {
  const size = measuredSize(row)
  return size === null ? PLACEHOLDER_BOX : `${size.width} / ${size.height}`
}

/** The wall: the rows in gallery order, dealt into the five columns. */
const columns = computed(() => columnsOf(gallery.value?.rows ?? [], COLUMN_COUNT, heightRatioOf))

/**
 * A tile's thumbnail URL — the cache-backed route, with the token on it the way
 * every other request carries it.
 */
function thumbnailUrl(name: string): string {
  return withToken(`/api/thumbnail/${encodeURIComponent(name)}`, consoleToken())
}

/** An id the page can key a row by: an entry's own, or a Mirror file's name. */
function rowKey(row: ConsoleGalleryRow): string {
  return `${row.id ?? 'no-id'} ${row.name}`
}

/** Open the viewer on a tile. The `<DialogTrigger>` beside this opens the root. */
function openViewer(row: ConsoleGalleryRow): void {
  shown.value = row
  viewerOpen.value = true
}

/**
 * The root's own state, which is the truth: every close — Escape, the close
 * control, a click on the scrim — arrives here, and `shown` is left in place so
 * the primitive can play the exit and hand focus back to the tile.
 */
function onViewerOpenChange(open: boolean): void {
  viewerOpen.value = open
}
</script>

<template>
  <section class="pb-24">
    <WallHeader :gallery="gallery" :failure="failure" />

    <!-- One `DialogRoot` for the wall, so each tile can be the trigger. -->
    <DialogRoot :open="viewerOpen" @update:open="onViewerOpenChange">
      <div class="flex items-start gap-gutter">
        <div
          v-for="(column, index) in columns"
          :key="index"
          class="flex min-w-0 flex-1 flex-col gap-gutter"
        >
          <template v-for="row in column" :key="rowKey(row)">
            <WallTile
              :row="row"
              :box="boxOf(row)"
              :thumbnail-url="thumbnailUrl(row.name)"
              @open="openViewer"
            />
          </template>
        </div>
      </div>

      <FullSizeView
        v-if="shown !== null"
        :id="shown.id"
        :name="shown.name"
        @close="onViewerOpenChange(false)"
      />
    </DialogRoot>
  </section>
</template>
