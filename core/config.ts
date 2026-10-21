import process from 'node:process'

import { dataRootOf, resolveAppRoot } from './app-root.js'
import type { ConfigValues } from './config-read.js'
import { galleryListUrlOf, parseConfig, readLayeredConfig, siteConfig } from './config-read.js'

// ── the eager configuration ───────────────────────────────────────
//
// The pipeline's configuration, parsed at module load: an unusable pair of
// layers throws here, before a Run can start, and every consumer below imports
// the constants it produced. The schema and the layered file read live in
// `core/config-read.ts`, which is also what the Console reads without throwing —
// importing *this* module is the strict parse, deliberately (#57).
//
// The root is an input: `resolveAppRoot` reads the environment a packaged
// launcher sets (`RE1999_APP_ROOT`) and falls back to the process's working
// directory for a source run. Nothing here looks at its own module's location
// (#78).

const APP_ROOT = resolveAppRoot()
const layered = readLayeredConfig({ appRoot: APP_ROOT, dataRoot: dataRootOf(APP_ROOT) })

// Re-parse the merged environment when the tolerant read found nothing usable:
// this is what keeps the pipeline's failure a `ZodError` with the exact key,
// exactly as `dotenv/config` + `parseConfig` gave it before #78.
const parsed: ConfigValues = layered.values ?? parseConfig(layered.env)
const site = siteConfig(APP_ROOT, parsed)

// `dotenv/config` used to put every file key into `process.env`, so a key the
// schema does not carry (the logger's `LOG_LEVEL`, `USER_AGENT`) was visible to
// whoever read the environment. Keep that half of dotenv's semantics for the
// pipeline, without overriding a real environment variable: this is a fresh
// process per Run, and the Console — which deliberately never loads the files —
// imports `core/config-read.ts`, not this module.
for (const [key, value] of Object.entries(layered.env)) {
  if (value !== undefined && process.env[key] === undefined) process.env[key] = value
}

// ── exports ───────────────────────────────────────────────────────

/** The application root: where `.env`, `node_modules/` and the Run's data live. */
export { APP_ROOT }

/** The one startup line saying the user's overrides were loaded, or `null`. */
export const USER_CONFIG_NOTICE = layered.notice

export const BASE_ORIGIN = parsed.BASE_ORIGIN
export const PAGE_PATH = parsed.PAGE_PATH
export const PAGE_URL = `${BASE_ORIGIN}${PAGE_PATH}`
// Hash is page logic, not env config (# is comment char in .env)
export const PAGE_HASH = '#wallpaper'
export const IMAGES_DIR = site.imagesDir
export const SESSION = site.sessionName
export const BATCH_SIZE = parsed.BATCH_SIZE
export const PLAYWRIGHT_CONFIG = parsed.PLAYWRIGHT_CONFIG
export const LOG_DIR = site.logDir
export const RUN_CACHE_DIR = site.runCacheDir
export const GALLERY_LIST_URL = galleryListUrlOf(BASE_ORIGIN)
export const GALLERY_STATE_FILE = site.galleryStateFile

export const USER_AGENT =
  process.env.USER_AGENT ??
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
