import * as path from 'node:path'
import process from 'node:process'

import { dataRootOf, resolveAppRoot } from './app-root.js'
import type { ConfigValues } from './config-read.js'
import { galleryListUrlOf, parseConfig, readLayeredConfig, siteConfig } from './config-read.js'
import { DATA_LAYOUT_FILE_NAME, DataLayoutError, layoutRefusalOf } from './data-layout.js'

// ── the eager configuration ───────────────────────────────────────
//
// The pipeline's configuration, parsed at module load: an unusable pair of
// layers throws here, before a Run can start, and every consumer below imports
// the constants it produced. The schema and the layered file read live in
// `core/config-read.ts`, which is also what the Console reads without throwing —
// importing *this* module is the strict parse, deliberately (#57).
//
// The two roots are inputs: `resolveAppRoot` reads the environment a packaged
// launcher sets (`RE1999_APP_ROOT`) and falls back to the process's working
// directory for a source run; `dataRootOf` reads `RE1999_DATA_ROOT` or the
// source tree's `<root>/data`. Nothing here looks at its own module's location
// (#78), and no data path is a child of the app root (#80).

const APP_ROOT = resolveAppRoot()
const DATA_ROOT = dataRootOf(APP_ROOT)
const layered = readLayeredConfig({ appRoot: APP_ROOT, dataRoot: DATA_ROOT })

// Re-parse the merged environment when the tolerant read found nothing usable:
// this is what keeps the pipeline's failure a `ZodError` with the exact key,
// exactly as `dotenv/config` + `parseConfig` gave it before #78.
const parsed: ConfigValues = layered.values ?? parseConfig(layered.env)
const site = siteConfig(APP_ROOT, parsed, DATA_ROOT)

// An unrecognised (usually newer) data layout must stop a Run before it can
// write into data it does not understand. This is a read-only check: the
// migration itself is `ensureDataLayout`, called by the entry points — never at
// module load, because merely importing this module must not touch the disk.
const layoutRefusal = layoutRefusalOf(path.join(DATA_ROOT, DATA_LAYOUT_FILE_NAME))
if (layoutRefusal !== null) throw new DataLayoutError(layoutRefusal)

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

/** The application root: where `.env`, `node_modules/` and the built page live. */
export { APP_ROOT }

/** The user's data directory: the Mirror, the Run logs, the cache and `user.env`. */
export { DATA_ROOT }

/** The one startup line saying the user's overrides were loaded, or `null`. */
export const USER_CONFIG_NOTICE = layered.notice

export const BASE_ORIGIN = parsed.BASE_ORIGIN
/**
 * The schema's raw `IMAGES_DIR` / `LOG_DIR`. They are what the legacy-layout
 * migration compares against the old checkout's directories, so a custom mirror
 * path is recognised too and not stranded in the program directory.
 */
export const IMAGES_DIR_SETTING = parsed.IMAGES_DIR
export const LOG_DIR_SETTING = parsed.LOG_DIR
export const IMAGES_DIR = site.imagesDir
export const BATCH_SIZE = parsed.BATCH_SIZE
export const LOG_DIR = site.logDir
export const GALLERY_LIST_URL = galleryListUrlOf(BASE_ORIGIN)
export const GALLERY_STATE_FILE = site.galleryStateFile

export const USER_AGENT =
  process.env.USER_AGENT ??
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
