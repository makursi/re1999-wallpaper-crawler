// ── Gallery state: cross-Run memory of the official list ────────────
//
// The site's list endpoint is the source of truth for what the gallery holds
// (see gallery-source.ts). This module keeps the one thing the endpoint cannot
// answer on its own — which entries the previous Run already saw — and derives
// the per-Run numbers from it: what is new, and how the local mirror compares
// to the official list.
//
// State lives next to the mirror it describes (`images/.gallery-state.json`):
// the ids are meaningless without those files, so the two are deleted together.

import * as fs from 'node:fs'

import { z } from 'zod'

import { wallpaperNameOf } from '../wallpaper-url.js'
import type { GalleryList } from './gallery-source.js'

export const GALLERY_STATE_VERSION = 1

export interface GalleryState {
  version: typeof GALLERY_STATE_VERSION
  /** Every entry id the gallery has exposed, ascending. */
  ids: number[]
  updatedAt: string
  runId: string
}

export interface MirrorGap {
  count: number
  files: string[]
}

export interface GalleryStats {
  /** What the list says the gallery holds; `null` when the list was unavailable. */
  officialTotal: number | null
  /** Entries new since the previous Run; `null` when there is nothing to compare. */
  newSinceLastRun: number | null
  newFiles: string[]
  firstRun: boolean
  /** How `images/` compares to the list; `null` when the list was unavailable. */
  mirror: { missingFromDisk: MirrorGap; extraOnDisk: MirrorGap } | null
}

export interface GallerySnapshot {
  list: GalleryList
  /** The names in `images/`; dotfiles (the state file) are ignored. */
  diskFiles: readonly string[]
}

/** Compare the official list with the mirror and remember the ids for the next Run. */
export function mergeGalleryStats(
  previous: GalleryState | null,
  { list, diskFiles }: GallerySnapshot,
  runId: string,
  at: string,
): { state: GalleryState; stats: GalleryStats } {
  const previousIds = new Set(previous?.ids ?? [])
  const officialNames = new Set(list.entries.map(entry => wallpaperNameOf(entry.url)))
  const diskNames = diskFiles.filter(name => !name.startsWith('.'))

  const newEntries =
    previous === null ? [] : list.entries.filter(entry => !previousIds.has(entry.id))
  const missing = [...officialNames].filter(name => !diskNames.includes(name))
  const extra = diskNames.filter(name => !officialNames.has(name))

  return {
    state: {
      version: GALLERY_STATE_VERSION,
      ids: list.entries.map(entry => entry.id).toSorted((a, b) => a - b),
      updatedAt: at,
      runId,
    },
    stats: {
      officialTotal: list.total,
      newSinceLastRun: previous === null ? null : newEntries.length,
      newFiles: newEntries.map(entry => wallpaperNameOf(entry.url)),
      firstRun: previous === null,
      mirror: {
        missingFromDisk: { count: missing.length, files: missing },
        extraOnDisk: { count: extra.length, files: extra.toSorted() },
      },
    },
  }
}

/**
 * The numbers for a Run whose list call failed. Nothing is invented: an
 * unknown total stays `null` rather than falling back to counting files, which
 * is how the gallery total used to end up wrong (docs/adr/0006).
 */
export function unavailableGalleryStats(previous: GalleryState | null): GalleryStats {
  return {
    officialTotal: null,
    newSinceLastRun: null,
    newFiles: [],
    firstRun: previous === null,
    mirror: null,
  }
}

const stateSchema = z.object({
  version: z.literal(GALLERY_STATE_VERSION),
  ids: z.array(z.number().int()),
  updatedAt: z.string(),
  runId: z.string(),
})

/**
 * Missing, unreadable or superseded state is not an error — it means "no
 * usable record yet", and the Run becomes a first Run.
 */
export function readGalleryState(file: string): GalleryState | null {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeGalleryState(file: string, state: GalleryState): void {
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}
