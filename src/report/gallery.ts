// ── Gallery total: how many Wallpapers the official gallery has ─────
//
// The gallery page exposes only a subset of its Wallpapers per Run (the
// virtual scroll list renders what is on screen), so no single Run can count
// the gallery. The count is therefore cumulative: every Run refreshes it from
// the Wallpapers on disk and carries the previous value forward, so a Run can
// say how many Wallpapers are known in total and how many are new.
//
// The state lives in its own file, not in the Run report: the report describes
// one Run, this is cross-Run memory. See docs/adr/0005.

import * as fs from 'node:fs'
import { IMAGE_EXTENSIONS } from '../wallpaper-url.js'

export interface GalleryStats {
  /** Wallpapers known in total (never decreases: the gallery only grows). */
  officialTotal: number
  /** The same number as the previous Run left it. */
  previousOfficialTotal: number
  /** Wallpapers added since the previous Run. */
  newSinceLastRun: number
  /** True when no previous record existed and the totals were back-derived. */
  firstRun: boolean
  updatedAt: string
  runId: string
}

/** A downloaded Wallpaper file, as opposed to a site asset that slipped in. */
export function isWallpaperFile(name: string): boolean {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  // `dot > 0` so a nameless dotfile like `.jpg` is not a Wallpaper
  return dot > 0 && IMAGE_EXTENSIONS.includes(lower.slice(dot))
}

export function countWallpapers(files: readonly string[]): number {
  return files.reduce((n, file) => (isWallpaperFile(file) ? n + 1 : n), 0)
}

export function mergeGalleryStats(
  previous: GalleryStats | null,
  currentTotal: number,
  newThisRun: number,
  runId: string,
  at: string,
): GalleryStats {
  if (previous === null) {
    // First record: reconstruct what the total must have been before this
    // Run's new downloads, so `newSinceLastRun` is not lost on upgrade.
    const previousOfficialTotal = Math.max(0, currentTotal - newThisRun)
    return {
      officialTotal: currentTotal,
      previousOfficialTotal,
      newSinceLastRun: currentTotal - previousOfficialTotal,
      firstRun: true,
      updatedAt: at,
      runId,
    }
  }

  const officialTotal = Math.max(previous.officialTotal, currentTotal)
  return {
    officialTotal,
    previousOfficialTotal: previous.officialTotal,
    newSinceLastRun: Math.max(0, officialTotal - previous.officialTotal),
    firstRun: false,
    updatedAt: at,
    runId,
  }
}

/** Missing or unreadable state is not an error — it just means "no record yet". */
export function readGalleryStats(file: string): GalleryStats | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null)
      return null
    const stored = parsed as Partial<GalleryStats>
    if (typeof stored.officialTotal !== 'number' || !Number.isFinite(stored.officialTotal))
      return null
    return {
      officialTotal: stored.officialTotal,
      previousOfficialTotal: typeof stored.previousOfficialTotal === 'number'
        ? stored.previousOfficialTotal
        : stored.officialTotal,
      newSinceLastRun: typeof stored.newSinceLastRun === 'number' ? stored.newSinceLastRun : 0,
      firstRun: stored.firstRun === true,
      updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : '',
      runId: typeof stored.runId === 'string' ? stored.runId : '',
    }
  }
  catch {
    return null
  }
}

export function writeGalleryStats(file: string, stats: GalleryStats): void {
  fs.writeFileSync(file, `${JSON.stringify(stats, null, 2)}\n`, 'utf8')
}
