// ── The Console's API contract, declared once ───────────────────────
//
// The page and the service share these payloads and nothing else. The module
// is type-only by construction — no `const`, no `enum`, no runtime value at
// all — so the page's `import type` is erased and no service code reaches the
// browser bundle (spec decision 27).

/** Which Run the Console is looking at (spec decision 16). */
export type ConsoleRunState = 'idle' | 'running' | 'orphaned'

/** The three-state verdict `check-run` prints (src/report/run-log.ts). */
export type ConsoleVerdict = 'clean' | 'explained' | 'defect'

/**
 * The Run report's defect block, verbatim (`RunReport['defects']`).
 *
 * Declared structurally instead of imported: the page's tsconfig
 * (`tsconfig.web.json`) deliberately has no node types, and importing
 * `src/report/run-log.ts` would pull `src/gallery/gallery-state.ts` — and its
 * `node:fs` — into the page's type program. `src/console/status.ts` carries the
 * compile-time check that this declaration and the Run report's stay the same
 * type.
 */
export interface ConsoleDefects {
  discoveryLeak: { count: number; urls: string[] }
  nonConverged: boolean
  emptyResult: boolean
  persistentFailures: number
  emptyFiles: string[]
  /** `null` = not checked, because the list was unavailable. */
  siteAssetFalsePositive: { count: number; urls: string[] } | null
  gallerySourceUnavailable: boolean
  mirrorGap: { missing: number; extra: number } | null
}

/** `GET /api/status` — the Console's whole view (spec decision 16). */
export interface ConsoleStatusPayload {
  /** The Run the verdict is about; `null` when no Run log names one. */
  runId: string | null
  state: ConsoleRunState
  /** The Run's own `run_meta.startedAt`; `null` when there is no Run. */
  startedAt: string | null
  /** Wallpapers in the Mirror: every non-dot entry (src/console/mirror.ts). */
  mirrorCount: number
  /** What the Gallery list says the gallery holds; `null` = not read. */
  officialTotal: number | null
  /** `null` while a Run is in flight, and when no Run report was read. */
  verdict: ConsoleVerdict | null
  /** The Run report's defect block, verbatim, so the two cannot disagree. */
  defects: ConsoleDefects | null
  /** `false` when the Gallery list could not be read — never "nothing missing". */
  listAvailable: boolean
}

/** How a gallery row stands against the Mirror (spec decision 17). */
export type ConsoleGalleryRowState = 'on-disk' | 'missing' | 'not-in-gallery'

/** One row of the gallery: a Gallery list entry, or a Mirror extra. */
export interface ConsoleGalleryRow {
  /** The gallery's own id; `null` for a Mirror file the list does not contain. */
  id: number | null
  /** The Wallpaper's file name (the secondary label). */
  name: string
  state: ConsoleGalleryRowState
}

/**
 * `GET /api/gallery` — the Gallery list read against the Mirror.
 *
 * The row model is `src/console/gallery-view.ts`'s `GalleryView`, which is
 * checked against this declaration at compile time (`toGalleryPayload`), plus
 * the Mirror's count.
 */
export interface ConsoleGalleryPayload {
  /** One row per Gallery list entry, then the Mirror's extras, sorted. */
  rows: ConsoleGalleryRow[]
  /** What the Gallery list says the gallery holds; `null` = not read. */
  officialTotal: number | null
  /** The newest Run report's "new since the last Run"; `null` = none read. */
  newSinceLastRun: number | null
  /** `false` when the Gallery list could not be read — never "nothing missing". */
  listAvailable: boolean
  /** Both directions of the gap; `null` = not checked, never `{0, 0}`. */
  mirrorGap: { missing: number; extra: number } | null
  /** Wallpapers in the Mirror: every non-dot entry (src/console/mirror.ts). */
  mirrorCount: number
}
