// ── The Console's configuration value ───────────────────────────────
//
// The service never reads the environment. `web/server/console.ts` reads the
// project's `.env` through `core/config-read.ts` — the non-throwing half of the
// same schema `core/config.ts` parses eagerly for the pipeline — and injects one
// of these, which is what keeps `tests/**` running with no `.env` (spec decision
// 29) and what lets the Console boot without one (#57).

export interface ConsoleConfig {
  /**
   * The repository root: a Run's cwd, where `.env`, `node_modules/`, the Mirror
   * and the Run log directory live. Not the web layer's root — the entry point
   * derives that one itself (spec decision 7).
   */
  projectRoot: string
  /** The Mirror (`images/`). The Console reads its names and writes nothing. */
  imagesDir: string
  /** The Run log directory — the Console's only source of truth about Runs. */
  logDir: string
  /** `images/.gallery-state.json`; read by later tickets, never written. */
  galleryStateFile: string
  /** The built page's root: Vite's `build.outDir`, under the web layer's root. */
  distDir: string
  /**
   * The site's Gallery list endpoint (core/config.ts › `GALLERY_LIST_URL`), or
   * `null` when there is no usable `.env`.
   *
   * `null` means "there is no usable configuration", not "the site is down": a
   * configured Console whose endpoint merely refuses a request degrades to the
   * same "not read" after trying. With `null` there is no URL to try, so the
   * Console makes no request at all — and this is also the boot fact
   * `/api/status` reports as `runConfigAvailable` (#57).
   */
  galleryListEndpoint: string | null
}

/** The Console's preferred port; `--port` overrides it (ADR 0008). */
export const DEFAULT_CONSOLE_PORT = 8791

/** The build output's directory name, relative to the web layer's root (ADR 0011). */
export const DIST_DIR_NAME = 'dist'
