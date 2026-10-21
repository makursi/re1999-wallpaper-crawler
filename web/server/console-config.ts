// ── The Console's configuration value ───────────────────────────────
//
// The service never reads the environment and never derives a directory from
// its own module location. `web/server/console.ts` resolves the one application
// root (#78), reads the layered configuration through `core/config-read.ts`'s
// file-reading predicate — the same schema `core/config.ts` parses eagerly for
// the pipeline — and injects one of these. That is what keeps `tests/**`
// running with no `.env` (spec decision 29) and what lets the Console boot
// without one (#57).

import * as path from 'node:path'

import type { ConfigValues, SiteConfig } from '../../core/config-read.js'
import { galleryListUrlOf } from '../../core/config-read.js'

export interface ConsoleConfig {
  /**
   * The application root, injected by the entry point: a Run's cwd, and where
   * `.env`, `node_modules/` and the built page live. It is never derived from
   * this layer's module position (#78).
   */
  appRoot: string
  /**
   * The user's data directory, injected by the entry point and never the app
   * root's child by deduction: the package's `<install>/data` is a sibling of
   * `<install>/app`, so replacing the program leaves the data alone (#80).
   */
  dataRoot: string
  /** The Mirror (`<data>/images`). The Console reads its names and writes nothing. */
  imagesDir: string
  /** The Run log directory — the Console's only source of truth about Runs. */
  logDir: string
  /** `images/.gallery-state.json`; read by later tickets, never written. */
  galleryStateFile: string
  /** `<data>/cache/thumbnails`; disposable, outside the Mirror (ADR 0010, #80). */
  cacheDir: string
  /** The built page's root: the app root's `web/dist` (ADR 0011). */
  distDir: string
  /**
   * The site's Gallery list endpoint (`core/config.ts` › `GALLERY_LIST_URL`), or
   * `null` when there is no usable layered configuration.
   *
   * `null` means "there is no usable configuration", not "the site is down": a
   * configured Console whose endpoint merely refuses a request degrades to the
   * same "not read" after trying. With `null` there is no URL to try, so the
   * Console makes no request at all. The endpoint is fixed for the process's
   * life; `/api/status`'s `runConfigAvailable` is a fresh layered read instead
   * (#57, #60), so a file created later clears the page's notice without the
   * Gallery list being re-derived.
   */
  galleryListEndpoint: string | null
}

/** The Console's preferred port; `--port` overrides it (ADR 0008). */
export const DEFAULT_CONSOLE_PORT = 8791

/** The build output's directory name, relative to the app root (ADR 0011). */
export const DIST_DIR_NAME = 'dist'

/**
 * Build the Console's configuration value from the application root and the
 * layered read. Pure, and here rather than in the entry point so a test can
 * prove the page's root comes from the injected app root: a module-relative
 * derivation would resolve to `tests/web/dist` there, and to nothing at all in
 * the packaged tree.
 */
export function consoleConfigOf(
  appRoot: string,
  values: ConfigValues | null,
  site: SiteConfig,
): ConsoleConfig {
  return {
    appRoot,
    dataRoot: site.dataRoot,
    imagesDir: site.imagesDir,
    logDir: site.logDir,
    galleryStateFile: site.galleryStateFile,
    cacheDir: site.cacheDir,
    distDir: path.join(appRoot, 'web', DIST_DIR_NAME),
    // Absent when there is no usable configuration: the Gallery list is then
    // "not read" and `/api/status` reports that a Run cannot be configured yet
    // (#57).
    galleryListEndpoint: values === null ? null : galleryListUrlOf(values.BASE_ORIGIN),
  }
}
