// ── The gallery as rows: the Gallery list read against the Mirror ────
//
// One pure function (spec decision 17): the wall is the Mirror. A row exists
// only for a Wallpaper really on disk — a Gallery list entry whose file is
// there and whose name the Wallpaper URL set accepts, in the list's order, then
// the Wallpaper extras the site has retired but the Mirror still holds, sorted.
// An entry with no file is not a row: no placeholder, no "not on disk", and no
// thumbnail request for a file that is not there.
//
// The gap is deliberately not derived from those rows. It is the same set
// arithmetic as `mergeGalleryStats` (core/gallery/gallery-state.ts:61-66), over
// the official name set and the disk name set, because the page and the Run
// report have to agree about the same directory (spec decision 18).
//
// No filesystem, no clock: the disk names arrive as data, so the page and the
// tests feed it the same way.

import type { GalleryList } from '../../core/gallery/gallery-source.js'
import { officialNamesOf } from '../../core/gallery/gallery-source.js'
import { isWallpaperFile, wallpaperNameOf } from '../../core/wallpaper-url.js'
import type { ConsoleGalleryPayload, ConsoleImageSize } from '../api-types.js'
import type { Same } from './same.js'

export interface GalleryRow {
  /** The gallery's own id; null for a retired Wallpaper the list dropped. */
  id: number | null
  /** The Wallpaper's file name. */
  name: string
}

export interface GalleryView {
  /** Only Wallpapers really on disk; the Gallery list's order first. */
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
  // name, so a stray `notes.txt` counts on both sides of the gap.
  const diskNames = diskFiles.filter(name => !name.startsWith('.'))
  const onDisk = new Set(diskNames)

  if (list === null) {
    // Degraded mode (§4): the Mirror's Wallpapers alone. "Not in the gallery"
    // needs the list, so every row is simply an extra and the gap stays `null`
    // — a missing count of 0 would be a claim the Mirror cannot support.
    return {
      rows: diskNames
        .filter(name => isWallpaperFile(name))
        .toSorted()
        .map(name => ({ id: null, name })),
      officialTotal: null,
      newSinceLastRun,
      listAvailable: false,
      mirrorGap: null,
    }
  }

  const official = officialNamesOf(list)
  const rows: GalleryRow[] = []
  for (const entry of list.entries) {
    const name = wallpaperNameOf(entry.url)
    // Both halves are the service's: the file has to be in the Mirror (a row
    // without one could only become a placeholder) and the name has to be one
    // the Wallpaper URL set accepts (the thumbnail route would answer 400).
    if (onDisk.has(name) && isWallpaperFile(name)) rows.push({ id: entry.id, name })
  }
  const extras = diskNames.filter(name => !official.has(name) && isWallpaperFile(name)).toSorted()
  for (const name of extras) rows.push({ id: null, name })

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
