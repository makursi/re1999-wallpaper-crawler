// ── The Console service's contract ──────────────────────────────────
//
// What a caller hands the service and what it hands back: the injected readers
// (spec decision 29), the two actions, the thumbnail source, and the handle a
// caller closes. It lives apart from the assembly in `../server.ts` so a route
// module can name the contract without importing the thing that builds the
// server — and `../server.ts` re-exports every type here, so a test or the entry
// point keeps importing it from the address it always used.
//
// Nothing here decides anything: these are shapes, and the judgement is in the
// modules the readers wrap (`status.ts`, `gallery-view.ts`, `run-control.ts`).

import type { ConsoleRunCleanupPayload, ConsoleRunStartPayload } from '../../api-types.js'
import type { ConsoleConfig } from '../console-config.js'
import type { GalleryListSource } from '../gallery-list-source.js'
import type { ImageSizeReader } from '../image-sizes.js'
import type { ConsoleGalleryFacts, ConsoleRunFacts } from '../status.js'

/**
 * What a start request answers. Declared here so #34 implements one shape: the
 * body is the page's `ConsoleRunStartPayload`, and `status` is the HTTP status
 * the refusal carries (409 when a Run is already in flight, 412 when a global
 * prerequisite is missing).
 */
export interface RunStartResult extends ConsoleRunStartPayload {
  status?: number
}

/** Starts a Run (spec decision 6). #32 fixes the seam; #34 implements it. */
export type RunStarter = () => Promise<RunStartResult>

/**
 * What a cleanup request answers (#36). `cleaned: false` is a refusal — only a
 * Run in flight refuses one — and `status` is the HTTP status it carries (409).
 */
export interface RunCleanupResult extends ConsoleRunCleanupPayload {
  status?: number
}

/** Cleans an Orphaned Run up (ADR 0009). #36 implements it. */
export type RunCleaner = () => Promise<RunCleanupResult>

/**
 * Image bytes for one thumbnail, generated — or read back from the cache —
 * after the request has been validated (#35).
 *
 * Injected like every other outside touch (spec decision 29), for one specific
 * reason: the image library's native addon may be absent or broken, and a test
 * must be able to assert the 500 that follows without owning that failure mode.
 * `web/server/console.ts` — the composition root — builds the real one; a service given
 * none answers a named 500 rather than crashing.
 */
export interface ThumbnailSource {
  thumbnail: (name: string, sourceFile: string) => Promise<Buffer>
}

export interface ConsoleServerDeps {
  /** The status's Run half. #32 injects the idle state; #34/#36 read the log. */
  runState: () => ConsoleRunFacts
  /** The status's Gallery half. #32 injects "not read"; #33 fetches the list. */
  galleryFacts: () => ConsoleGalleryFacts | Promise<ConsoleGalleryFacts>
  /** The Run starter (`createRunStarter`): `POST /api/run`'s whole answer. */
  startRun: RunStarter
  /**
   * The Orphaned Run cleanup (`createRunCleaner`): `POST /api/run/cleanup`'s
   * whole answer (#36).
   *
   * Optional on purpose: a service without Run control — #32's shape and its
   * tests — has no cleanup to offer, and the honest answer to that route is
   * `404`, not a no-op that claims it cleaned something.
   */
  cleanupRun?: RunCleaner
  /**
   * Whether a Run's site configuration is usable *now* (#60).
   *
   * `/api/status` carries it as `runConfigAvailable`, and the page shows its
   * setup notice while it is `false`. The entry point injects a fresh read of
   * the repository's `.env` — the same predicate the start's `env-file` refusal
   * makes — so creating the file clears the notice on the next status read
   * instead of requiring a Console restart.
   *
   * Optional on purpose: a service given only a configuration value (a test, or
   * a service with no Run control) falls back to #57's boot fact, which is the
   * truthful answer for that service.
   */
  runConfigAvailable?: () => boolean
  /** This start's access token, generated per start and never persisted. */
  token: string
  /** The port to prefer; `0` asks the OS for one (tests). */
  port: number
  /**
   * The cached Gallery list `GET /api/gallery` reads (#33). The entry injects
   * the same source behind `galleryFacts`, so the two routes cannot disagree
   * about whether the list was read.
   *
   * Optional on purpose: a service that only answers `/api/status` — #32's
   * shape and its tests — legitimately has no list, and the gallery route's
   * honest answer to that is the degraded view ("the list was not read"), not
   * a 500 and not a fabricated empty list.
   */
  galleryList?: GalleryListSource
  /**
   * The newest Run report's `gallery.newSinceLastRun` (#33): read from the log
   * the same way `check-run` picks it, never recomputed from the Gallery state
   * (recomputing gives 0). Absent or `null` = nothing to report.
   */
  newSinceLastRun?: () => number | null
  /**
   * The thumbnail generator (#35). `web/server/console.ts` injects the real one;
   * absent means "this service cannot render", which the route answers as a
   * named 500 — never a crash and never a 404.
   */
  thumbnailSource?: ThumbnailSource
  /**
   * The Wallpapers' own pixel sizes, as the Mirror's files hold them (#48).
   *
   * The wall is masonry and its columns are balanced against heights, so the
   * page needs each tile's proportion *before* the lazy thumbnail arrives —
   * otherwise every image that loads re-balances the wall under the reader's
   * cursor. `web/server/console.ts` injects the measurement, memoised per file
   * for the process's life.
   *
   * Optional on purpose: a service given none (and #32's status-only shape) has
   * no sizes, and the wall falls back to placeholder proportions. A missing
   * measurement is a slightly less exact column, never an error.
   */
  imageSizeSource?: ImageSizeReader
}

export interface ConsoleService {
  /** `http://127.0.0.1:<port>` — the authority every request has to present. */
  origin: string
  /** The port actually bound, never the requested one (spec decision 3). */
  port: number
  /** `true` when the preferred port was taken and the OS assigned another. */
  fellBack: boolean
  /** The page's URL with the token on it — what the entry prints and opens. */
  url: string
  close: () => Promise<void>
}

/**
 * What a route needs from the service it belongs to.
 *
 * The configuration value and the injected readers are fixed for the process,
 * but the port is not known until `listen` resolves — and the guard compares the
 * `Host` header against it on every request. So the port is read from this
 * object at request time, never captured at build time.
 */
export interface ServiceRuntime {
  config: ConsoleConfig
  deps: ConsoleServerDeps
  /** The port actually bound; `0` until `listen` has resolved. */
  port: number
}
