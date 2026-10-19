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
// keeps the wall still while it loads, and what lets `web/src/masonry.ts`
// balance the columns against real heights instead of guessing from whatever
// the browser happens to have loaded. A row the service could not measure falls
// back to a portrait placeholder box, which is a guess and is allowed to be one.
//
// The dialog belongs here rather than in the viewer: each tile is a
// `DialogTrigger`, which is what gives reka-ui a trigger to hand focus back to
// when the viewer closes (#48's first verified defect).

import { DialogRoot, DialogTrigger } from 'reka-ui'
import { computed, onMounted, ref } from 'vue'

import type { ConsoleGalleryPayload, ConsoleGalleryRow, ConsoleImageSize } from '../api-types.js'
import { consoleToken } from './console-token'
import FullSizeView from './FullSizeView.vue'
import { t } from './i18n/locale'
import Message from './i18n/Message.vue'
import { GALLERY_ROW_STATE_MESSAGE_KEYS } from './i18n/messages'
import { columnsOf } from './masonry'

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

const gallery = ref<ConsoleGalleryPayload | null>(null)
const failure = ref<string | null>(null)

/** The tile the viewer is showing; kept after a close so the exit can finish. */
const shown = ref<ConsoleGalleryRow | null>(null)
/** Whether the viewer is open; `shown` deliberately outlives it (see above). */
const viewerOpen = ref(false)

async function loadGallery(): Promise<void> {
  try {
    const response = await fetch(`/api/gallery?token=${encodeURIComponent(consoleToken())}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    // The service's own payload; its shape is declared once, in
    // web/api-types.ts, and imported here as a type only.
    gallery.value = (await response.json()) as ConsoleGalleryPayload
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => {
  void loadGallery()
})

/**
 * The image extensions the service serves (`IMAGE_EXTENSIONS`,
 * core/wallpaper-url.ts). A `not-in-gallery` file can be any non-dot name the
 * Mirror holds, so the tile asks for a thumbnail only when the name could be
 * an image at all — otherwise the request is a guaranteed 400 per tile.
 */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/**
 * The tone a state that has no image reads in. `missing` is the fault — the
 * official list names a Wallpaper the Mirror does not hold — while
 * `not-in-gallery` is the list having moved on; the two are different
 * statements, so they are not the same colour.
 */
const STATE_TONES: Record<ConsoleGalleryRow['state'], string> = {
  'on-disk': 'text-secondary',
  missing: 'text-danger',
  'not-in-gallery': 'text-warning',
}

/** The official total as the reader sees it: a number, or "not read". */
const officialTotal = computed(() => {
  const total = gallery.value?.officialTotal
  return total == null ? t('gallery.notRead') : total
})

/** The newest-Run clause, or nothing when there is nothing to compare against. */
const newestRunAdded = computed(() => gallery.value?.newSinceLastRun ?? undefined)

/** `true` when a file with this name stands a chance of being an image. */
function isImageName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && IMAGE_EXTENSIONS.includes(name.slice(dot).toLowerCase())
}

/** `true` when the tile can show a thumbnail at all. */
function isViewable(row: ConsoleGalleryRow): boolean {
  if (row.state === 'missing') return false
  return isImageName(row.name)
}

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
  return `/api/thumbnail/${encodeURIComponent(name)}?token=${encodeURIComponent(consoleToken())}`
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
    <!-- The wall's head: the caption is the reading of the wall, not a panel,
         and above it sits the position the site fills with a WALLPAPER type
         image — filled here with real text and no image at all (ADR 0015,
         story 20). The eyebrow tag carries the Chinese name of the view, so the
         display mark leads and the reader still knows what this is. -->
    <div class="mb-10 flex flex-col gap-4">
      <h2
        class="flex items-center gap-3 font-serif text-xs font-bold text-muted uppercase tracking-[0.35em]"
      >
        <span class="h-px w-10 bg-border" aria-hidden="true" />
        {{ t('gallery.heading') }}
      </h2>
      <!-- The display mark: Playfair Display at display scale, in the site's
           own logotype ink. A logotype is the same word in both locales, so it
           is a dictionary key with one value rather than a translation. -->
      <p class="font-serif text-7xl leading-none tracking-[0.12em] text-logotype">
        {{ t('wall.mark') }}
      </p>
      <div class="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p v-if="gallery !== null" class="text-secondary text-sm">
          <Message
            message="gallery.counts"
            :params="{ officialTotal, mirrorCount: gallery.mirrorCount }"
          />
        </p>
        <p v-if="newestRunAdded !== undefined" class="text-secondary text-sm">
          <Message message="gallery.newestRunAdded" :params="{ newSinceLastRun: newestRunAdded }" />
        </p>
      </div>
      <p v-if="failure !== null" class="text-danger text-sm">{{ failure }}</p>
      <p v-else-if="gallery === null" class="text-muted text-sm">{{ t('gallery.reading') }}</p>
      <p v-else-if="!gallery.listAvailable" class="max-w-[52rem] text-muted text-sm">
        {{ t('gallery.listUnavailable') }}
      </p>
      <p v-else-if="gallery.mirrorGap !== null" class="max-w-[52rem] text-muted text-sm">
        <Message
          message="gallery.mirrorGap"
          :params="{ missing: gallery.mirrorGap.missing, extra: gallery.mirrorGap.extra }"
        />
      </p>
    </div>

    <!-- One `DialogRoot` for the wall, so each tile can be the trigger. -->
    <DialogRoot :open="viewerOpen" @update:open="onViewerOpenChange">
      <div class="flex items-start gap-gutter">
        <div
          v-for="(column, index) in columns"
          :key="index"
          class="flex min-w-0 flex-1 flex-col gap-gutter"
        >
          <template v-for="row in column" :key="rowKey(row)">
            <!-- A tile is square-cornered, shadowless and carries its 1px border
                 from the start — transparent until hover, so the rust hairline
                 costs no layout at all. -->
            <DialogTrigger v-if="isViewable(row)" as-child>
              <button
                type="button"
                class="block w-full cursor-pointer overflow-hidden border border-transparent bg-surface p-0 transition-colors duration-hover ease-standard hover:border-accent focus-visible:border-accent focus-visible:outline-none"
                :style="{ aspectRatio: boxOf(row) }"
                :aria-label="t('gallery.tileShow', { name: row.name })"
                @click="openViewer(row)"
              >
                <img
                  class="block h-full w-full object-contain"
                  :src="thumbnailUrl(row.name)"
                  :alt="row.name"
                  loading="lazy"
                  decoding="async"
                />
              </button>
            </DialogTrigger>
            <!-- A Wallpaper with no local file is a state, not a fault: a local
                 placeholder, never a broken image and never a fetch to the CDN
                 (spec decision 25; #35 AC 5). It keeps the row's own name, so
                 the identifier stays readable for a tile that cannot be
                 opened. -->
            <div
              v-else
              class="grid w-full place-content-center gap-1 overflow-hidden border border-dashed border-border bg-surface p-2 text-center text-xs"
              role="img"
              :style="{ aspectRatio: boxOf(row) }"
              :aria-label="t('gallery.tileNotOnDisk', { name: row.name })"
            >
              <span class="i-ph-image-light mx-auto text-xl text-muted" aria-hidden="true" />
              <span :class="STATE_TONES[row.state]">{{
                t(GALLERY_ROW_STATE_MESSAGE_KEYS[row.state])
              }}</span>
              <code class="break-all text-[0.7rem] text-muted">{{ row.name }}</code>
            </div>
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
