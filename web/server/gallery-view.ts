// ── The gallery as rows: the Gallery list read against the Mirror ────
//
// One pure function (spec decision 17): the site's Gallery list is the row
// set's spine — one row per entry, labelled by the gallery's own id, with the
// Wallpaper's file name as the secondary label — and the Mirror's files the
// list does not contain follow as `not-in-gallery` rows. No filesystem, no
// clock: the disk names arrive as data, so the page and the tests feed it the
// same way.
//
// The gap arithmetic deliberately copies `mergeGalleryStats`
// (core/gallery/gallery-state.ts:61-66), because the page and the Run report
// have to agree about the same directory (spec decision 18).

import type { GalleryList } from '../../core/gallery/gallery-source.js'
import { officialNamesOf } from '../../core/gallery/gallery-source.js'
import { isWallpaperFile, wallpaperNameOf } from '../../core/wallpaper-url.js'
import type { ConsoleGalleryPayload, ConsoleImageSize } from '../api-types.js'
import type { Same } from './same.js'

/** How a row stands against the Mirror. */
export type GalleryRowState = 'on-disk' | 'missing' | 'not-in-gallery'

export interface GalleryRow {
  /** The gallery's own id; null for a Mirror file the list does not contain. */
  id: number | null
  /** The Wallpaper's file name (the secondary label). */
  name: string
  state: GalleryRowState
  /**
   * Whether the page can show this row: the file is in the Mirror and the name
   * is one the Wallpaper URL set accepts.
   *
   * The service decides it because both inputs are the service's — the row's
   * state and the Wallpaper URL set's vocabulary, `isWallpaperFile`. The page
   * used to hold a hand-copied copy of that vocabulary, which is exactly the
   * kind of duplicate that drifts: a non-image Mirror extra then produced one
   * thumbnail request per paint that could only ever answer 400.
   */
  viewable: boolean
}

export interface GalleryView {
  rows: GalleryRow[]
  officialTotal: number | null
  newSinceLastRun: number | null
  listAvailable: boolean
  /** null = not checked (the list was not read) — NEVER 0. */
  mirrorGap: { missing: number; extra: number } | null
}

export function buildGalleryView(input: {
  list: GalleryList | null
  diskFiles: readonly string[]
  newSinceLastRun: number | null
}): GalleryView {
  const { list, diskFiles, newSinceLastRun } = input
  // The Run report's predicate, not `isWallpaperFile` (§4a): every non-dot
  // name, so a stray `notes.txt` counts on both sides.
  const diskNames = diskFiles.filter(name => !name.startsWith('.'))
  const onDisk = new Set(diskNames)

  if (list === null) {
    // Degraded mode (§4): the Mirror's files alone. "Not in the gallery" needs
    // the list, so every row is simply on disk and the gap stays `null` — a
    // missing count of 0 would be a claim the Mirror cannot support.
    return {
      rows: diskNames.map(name => ({
        id: null,
        name,
        state: 'on-disk',
        viewable: isWallpaperFile(name),
      })),
      officialTotal: null,
      newSinceLastRun,
      listAvailable: false,
      mirrorGap: null,
    }
  }

  const official = officialNamesOf(list)
  const rows: GalleryRow[] = list.entries.map(entry => {
    const name = wallpaperNameOf(entry.url)
    const onDiskHere = onDisk.has(name)
    return {
      id: entry.id,
      name,
      state: onDiskHere ? 'on-disk' : 'missing',
      // A row the Mirror does not hold has no file to show; a row it holds
      // still has to be a Wallpaper, because the Mirror takes every non-dot
      // name and the route serves only the Wallpaper URL set.
      viewable: onDiskHere && isWallpaperFile(name),
    }
  })
  const extraNames = diskNames.filter(name => !official.has(name)).toSorted()
  for (const extra of extraNames) {
    rows.push({
      id: null,
      name: extra,
      state: 'not-in-gallery',
      viewable: isWallpaperFile(extra),
    })
  }

  return {
    rows,
    officialTotal: list.total,
    newSinceLastRun,
    listAvailable: true,
    // Set arithmetic over the official name set and the disk name set — the Run
    // report's own (`gallery-state.ts:65-66`). Rows are per *entry*, so two
    // entries sharing a name would make a row-derived count disagree.
    mirrorGap: {
      missing: [...official].filter(name => !onDisk.has(name)).length,
      extra: diskNames.filter(name => !official.has(name)).length,
    },
  }
}

/**
 * The payload `GET /api/gallery` answers: the view, the Mirror's count, and the
 * rows' own pixel sizes (#48).
 *
 * The sizes arrive from the route rather than from this pure view, because
 * reading them is a filesystem touch and this module has none. They are the
 * second input the wall needs and the page cannot supply: a masonry column is
 * balanced against heights, and the thumbnails are lazy.
 *
 * The conditional return type is a compile-time check that the pure view, the
 * sizes and the API contract in `api-types.ts` stay the same shape: a field
 * added, dropped or retyped on either side turns the return type into `never`,
 * so this stops compiling rather than letting the page be handed a payload the
 * service does not send.
 */
export function toGalleryPayload(
  view: GalleryView,
  mirrorCount: number,
  sizes: Record<string, ConsoleImageSize>,
): Same<
  GalleryView & { mirrorCount: number; sizes: Record<string, ConsoleImageSize> },
  ConsoleGalleryPayload
> extends true
  ? ConsoleGalleryPayload
  : never {
  return { ...view, mirrorCount, sizes }
}
