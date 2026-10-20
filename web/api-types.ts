// ── The Console's API contract, declared once ───────────────────────
//
// The page and the service share these payloads and nothing else. The module is
// type-only in everything that describes a payload — no class, no `enum`, no
// service logic — so the page's `import type` is erased and no service code
// reaches the browser bundle (spec decision 27). The exception is the code
// vocabularies: every code the service can emit — refusals, prerequisites,
// explained reasons, verdicts and gallery row states — is a runtime tuple,
// because the dictionary test has to enumerate them to prove that each one has
// copy in both locales (#47). They are data, not behaviour.

/** Which Run the Console is looking at (spec decision 16). */
export type ConsoleRunState = 'idle' | 'running' | 'orphaned'

// ── The code vocabulary (#47) ───────────────────────────────────────
//
// The service stops writing prose and starts emitting stable codes; the page
// owns every word (docs/adr/0014). A code that exists only as a union member
// cannot be enumerated, so these are `const` tuples whose element type is the
// code type — one home for the vocabulary, read by the page, the service and
// the dictionary test alike.

/** Why a Run start, or an orphan cleanup, was refused. */
export const REFUSAL_CODES = ['run-busy', 'orphaned-run', 'missing-prerequisite'] as const

/** A refusal's stable code. */
export type RefusalCode = (typeof REFUSAL_CODES)[number]

/** One global prerequisite a Run needs; the names used to be English prose. */
export const PREREQUISITE_CODES = ['playwright-cli', 'chrome', 'env-file', 'tsx-entry'] as const

/** A prerequisite's stable code. */
export type PrerequisiteCode = (typeof PREREQUISITE_CODES)[number]

/** One routine defect class a verdict called `explained`. */
export const EXPLAINED_REASON_KINDS = ['discovery-leak', 'mirror-gap-extra'] as const

/** An explained reason's stable kind. */
export type ExplainedReasonKind = (typeof EXPLAINED_REASON_KINDS)[number]

/**
 * One routine class the verdict explained — structured data, not a sentence
 * (`core/report/run-log.ts` built `discoveryLeak: …` / `mirrorGap: extra N`
 * before #47). The page lays it out in the reader's language.
 *
 * The layering is why this restates core's `RunExplainedReason`: the page must
 * not import `core/**`, so the shape is declared here and checked in
 * `web/server/status.ts`.
 */
export type ConsoleExplainedReason =
  | { kind: 'discovery-leak'; urls: string[] }
  | { kind: 'mirror-gap-extra'; count: number }

/** A refusal: the code, and the parameters its copy interpolates. */
export interface ConsoleRefusal {
  code: RefusalCode
  /** The prerequisites `missing-prerequisite` names; `[]` for the other codes. */
  missing: PrerequisiteCode[]
}

/** The three-state verdict `check-run` prints (core/report/run-log.ts). */
export const CONSOLE_VERDICTS = ['clean', 'explained', 'defect'] as const

/** A verdict's stable code. */
export type ConsoleVerdict = (typeof CONSOLE_VERDICTS)[number]

/**
 * The Run report's defect block, verbatim (`RunReport['defects']`).
 *
 * Declared structurally instead of imported: the page's tsconfig
 * (`web/tsconfig.web.json`) deliberately has no node types, and importing
 * `core/report/run-log.ts` would pull `core/gallery/gallery-state.ts` — and its
 * `node:fs` — into the page's type program. `web/server/status.ts` carries the
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

/** One side of the Mirror gap (`GalleryStats['mirror']`). */
export interface ConsoleMirrorGap {
  count: number
  files: string[]
}

/** The Run report's Gallery numbers, verbatim (`GalleryStats`). */
export interface ConsoleGalleryStats {
  /** What the list said the gallery held; `null` when the list was unavailable. */
  officialTotal: number | null
  /** Entries new since the previous Run; `null` when there was nothing to compare. */
  newSinceLastRun: number | null
  newFiles: string[]
  firstRun: boolean
  /** `null` = the Mirror check was not performed, because the list was unavailable. */
  mirror: { missingFromDisk: ConsoleMirrorGap; extraOnDisk: ConsoleMirrorGap } | null
}

/** The Run report's Discovery numbers, verbatim (`DiscoveryStats`). */
export interface ConsoleDiscoveryStats {
  converged: boolean
  stableRounds: number
  totalIdleSec: number
  networkCount: number
  domCount: number
  combinedCount: number
  thumbnailsClicked: number
  discoveryDurationMs: number
  coverage: number | null
}

/** One Download failure, verbatim (`RunReport['failures']`). */
export interface ConsoleFailure {
  url: string
  status?: number
  reason: string
  retried: boolean
}

/** The Run report's Download numbers, verbatim (`DownloadMetrics`). */
export interface ConsoleDownloadMetrics {
  total: number
  ok: number
  skipped: number
  failed: number
  successRate: number
  retryRescued: number
  retryTotal: number
  rescueRate: number
  emptyFiles: number
  emptyFilenames: string[]
  persistentFailures: number
  totalBytes: number
  avgDownloadMs: number
  statusHistogram: Record<string, number>
  failureGroups: { status: string; count: number }[]
  failures: ConsoleFailure[]
}

/**
 * The newest Run report, verbatim (`RunReport`).
 *
 * Structural for the same reason `ConsoleDefects` is: importing
 * `core/report/report.ts` would pull `core/gallery/gallery-state.ts`, and its
 * `node:fs`, into the page's type program. `web/server/status.ts` carries the
 * compile-time check that the two stay the same type, so the page cannot
 * quietly lose a field the Run report grew.
 *
 * Ticket #34 shows the Gallery numbers, Download numbers and defects together,
 * which is why the whole report travels rather than the numbers being
 * re-summarised here — a re-summary is a second representation of a Run.
 */
export interface ConsoleRunReport {
  type: 'run_report'
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  discovery: ConsoleDiscoveryStats
  download: ConsoleDownloadMetrics
  gallery: ConsoleGalleryStats
  siteAssets: { count: number; urls: string[] }
  defects: ConsoleDefects
  failures: ConsoleFailure[]
}

/** `POST /api/run` — the start, or the refusal it was answered with. */
export interface ConsoleRunStartPayload {
  started: boolean
  /** Why a start was refused; `null` when one was started. */
  refusal: ConsoleRefusal | null
}

/**
 * `POST /api/run/cleanup` — the answer to "clean this Orphaned Run up" (#36).
 *
 * `cleaned: false` is a refusal with its code, and `409` is the only refusal:
 * a Run in flight is never cleaned under. `cleaned: true` means the leftover
 * Browser session was asked to close and the log's claim was acknowledged in
 * memory. No Run log is deleted or rewritten by either answer.
 */
export interface ConsoleRunCleanupPayload {
  cleaned: boolean
  /** Why the cleanup was refused; `null` when it happened. */
  refusal: ConsoleRefusal | null
}

/**
 * Why the verdict is what it is — `assessRun`'s own reasons, which the Run
 * report's `defects` block does not carry.
 *
 * A `defect` is decided from three things beyond the report's defect classes:
 * whether the Gallery state names this Run (`stateMatchesReport`), the claimed
 * new files the probe rejected (`missingOnDisk`), and the routine classes the
 * verdict explained. `check-run` prints all three next to the report's defects
 * (core/check-run.ts › `printVerdict`), so the page can show them too: a Run
 * whose report's defect block is entirely clean must never read `defect` with
 * nothing to explain why (#34 story 11).
 */
export interface ConsoleVerdictReasons {
  /** `null` when the Gallery state is unreadable — never confused with `false`. */
  stateMatchesReport: boolean | null
  /** Claimed new files the probe rejected (absent, or zero bytes). */
  missingOnDisk: string[]
  /** The routine defect classes that were detected, as structured reasons (#47). */
  explained: ConsoleExplainedReason[]
}

/** `GET /api/status` — the Console's whole view (spec decision 16). */
export interface ConsoleStatusPayload {
  /** The Run the verdict is about; `null` when no Run log names one. */
  runId: string | null
  state: ConsoleRunState
  /** The Run's own `run_meta.startedAt`; `null` when there is no Run. */
  startedAt: string | null
  /** Wallpapers in the Mirror: every non-dot entry (web/server/mirror.ts). */
  mirrorCount: number
  /** What the Gallery list says the gallery holds; `null` = not read. */
  officialTotal: number | null
  /** `null` while a Run is in flight, and when no Run report was read. */
  verdict: ConsoleVerdict | null
  /** The Run report's defect block, verbatim, so the two cannot disagree. */
  defects: ConsoleDefects | null
  /**
   * Why the verdict is what it is — `assessRun`'s own reasons, which the report's
   * `defects` block does not carry. `null` while a Run is in flight.
   */
  verdictReasons: ConsoleVerdictReasons | null
  /** `false` when the Gallery list could not be read — never "nothing missing". */
  listAvailable: boolean
  /**
   * Whether a Run's site configuration is usable *now*: `true` only when the
   * repository root's `.env` exists and validates against the whole
   * configuration schema a Run parses, defaulted keys included. Read on each
   * status request (#60) — one file, no `PATH` scan and no registry lookup —
   * from the same predicate the start's `env-file` refusal uses, so the page's
   * ambient setup notice clears on the next status read (a reload, or the next
   * poll while a Run is in flight) and can never disagree with what a click
   * returns (#57).
   */
  runConfigAvailable: boolean
  /**
   * The newest Run report, verbatim (#34): the Gallery numbers, Download
   * numbers and detected defects the owner judges together. `null` while a Run
   * is in flight and when no readable report was found.
   */
  report: ConsoleRunReport | null
  /**
   * Whether the newest Run log carries a `run_report` record at all, readable
   * or not. `report === null && reportPresent` is a report this Console cannot
   * read — an older Run contract — which is a different statement from a
   * missing one, and the page must not merge them.
   */
  reportPresent: boolean
  /**
   * The newest Run log's file name (#36), so the page can name the log whose
   * claim it is offering to clean up. Absent when no log was read, which is
   * why it is optional rather than `null`-valued here.
   */
  runLogName?: string
}

/** How a gallery row stands against the Mirror (spec decision 17). */
export const GALLERY_ROW_STATES = ['on-disk', 'missing', 'not-in-gallery'] as const

/** A gallery row's stable state code. */
export type ConsoleGalleryRowState = (typeof GALLERY_ROW_STATES)[number]

/**
 * One Wallpaper's own pixel size (#48).
 *
 * The gallery wall is masonry: a tile stands in the shortest column, and a tile
 * that reports its height *after* it loads re-balances the wall under the
 * reader's cursor. So the page needs the proportion before the image arrives,
 * and the service is the only side that can read it off the file.
 */
export interface ConsoleImageSize {
  width: number
  height: number
}

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
 * The row model is `web/server/gallery-view.ts`'s `GalleryView`, which is
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
  /** Wallpapers in the Mirror: every non-dot entry (web/server/mirror.ts). */
  mirrorCount: number
  /**
   * The rows' own pixel sizes, by file name (#48). A name the service could not
   * measure — a file that is not there, a name that is not an image, a Mirror
   * the image library cannot read — is absent from this map rather than present
   * as `0 × 0`: "not measured" is not a size, and the page falls back to a
   * placeholder proportion for those tiles.
   */
  sizes: Record<string, ConsoleImageSize>
}
