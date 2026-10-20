import process from 'node:process'

import 'dotenv/config'

import type { ConfigValues } from './config-read.js'
import { galleryListUrlOf, parseConfig, PROJECT_ROOT, siteConfig } from './config-read.js'

// ── the eager configuration ───────────────────────────────────────
//
// The pipeline's configuration, parsed at module load: an absent or invalid
// `.env` throws here, before a Run can start, and every consumer below imports
// the constants it produced. The schema and the tree-relative resolution live in
// `core/config-read.ts`, which is also what the Console reads without throwing —
// importing *this* module is the strict parse, deliberately (#57).

const parsed: ConfigValues = parseConfig(process.env)
const site = siteConfig(PROJECT_ROOT, parsed)

// ── exports ───────────────────────────────────────────────────────

/** The repository root: a Run's cwd, where `.env`, `node_modules/` and the data live. */
export { PROJECT_ROOT }

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
