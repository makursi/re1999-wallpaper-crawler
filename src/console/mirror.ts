// ── The Mirror's Wallpaper count ────────────────────────────────────
//
// One number, and the one predicate that keeps it honest with the Run report.

import * as fs from 'node:fs'

/**
 * The Mirror count: every non-dot entry of the Mirror, by name.
 *
 * This is deliberately NOT `isWallpaperFile`, because `mergeGalleryStats`
 * filters the Mirror's names with `!name.startsWith('.')` before it computes
 * `extraOnDisk` (src/gallery/gallery-state.ts:62). A name the Run report counts
 * as extra has to be a name this count includes, or a stray `notes.txt` — or a
 * cache directory that somebody put back inside `images/` — would make the page
 * and the Run report disagree about the same directory. Both predicates return
 * 1013 today, which is exactly why the wrong choice would stay invisible
 * (spec decision 18; .console-notes/00-conventions.md §4a).
 */
export function countMirrorNames(names: readonly string[]): number {
  return names.filter(name => !name.startsWith('.')).length
}

/**
 * `countMirrorNames` against the Mirror on disk. A Mirror that is not there
 * yet holds nothing — the reading `src/main.ts` takes when it reads `images/`.
 */
export function countMirrorWallpapers(imagesDir: string): number {
  try {
    return countMirrorNames(fs.readdirSync(imagesDir))
  } catch {
    return 0
  }
}
