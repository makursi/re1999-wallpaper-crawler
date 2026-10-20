// ── The configuration schema, and the ways to read it ──────────────
//
// One schema, three reads, and one deliberate split from `core/config.ts`:
//
//   - `parseConfig` is the strict read. `core/config.ts` calls it at module load
//     and re-exports the values as the eager constants the pipeline imports, so
//     an absent or invalid `.env` still throws before a Run starts.
//   - `readConfig` is the tolerant read of an environment object: the validated
//     values, or `null` for "no usable configuration".
//   - `readProjectConfig` is the file-reading read: `<projectRoot>/.env` parsed
//     with dotenv's own parser, the process environment merged over it and the
//     whole schema applied. It is the one answer to "is `.env` usable now",
//     shared by the start's `env-file` refusal and the page's setup notice.
//
// The Console has to reach its page with no `.env` at all, and importing
// `core/config.ts` *is* the parse — so the Console imports this module instead
// (#57).
//
// The schema lives here and only here. So do the tree-relative defaults
// (`siteConfig`), because a Console booting without `.env` still has to read the
// same Mirror and Run log directory a Run would.

import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

import { parse as parseDotenv } from 'dotenv'
import { z } from 'zod'

// ── the tree ──────────────────────────────────────────────────────

/** The repository root: this module sits one level below it. */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')

// ── configuration schema ──────────────────────────────────────────

// The schema's defaults, named: `siteConfig` has to resolve the same directories
// for a Console that never read a `.env`, so the fallbacks cannot be two literals.
const DEFAULT_SESSION_NAME = 'bluepoch'
const DEFAULT_IMAGES_DIR = 'images'
const DEFAULT_LOG_DIR = 'logs'
const DEFAULT_PLAYWRIGHT_CONFIG = '.playwright/config.json'
const DEFAULT_BATCH_SIZE = 4
const RUN_CACHE_DIR_NAME = '.run-cache'
const GALLERY_STATE_FILE_NAME = '.gallery-state.json'
// The site's own gallery list path, relative to BASE_ORIGIN (docs/adr/0006).
const GALLERY_LIST_PATH = '/activity/official/websites/picture/query'

export const configSchema = z.object({
  BASE_ORIGIN: z.url(),
  PAGE_PATH: z.string().min(1),
  SESSION_NAME: z.string().min(1).default(DEFAULT_SESSION_NAME),
  IMAGES_DIR: z.string().min(1).default(DEFAULT_IMAGES_DIR),
  BATCH_SIZE: z.coerce.number().int().positive().max(20).default(DEFAULT_BATCH_SIZE),
  PLAYWRIGHT_CONFIG: z.string().min(1).default(DEFAULT_PLAYWRIGHT_CONFIG),
  LOG_DIR: z.string().min(1).default(DEFAULT_LOG_DIR),
})

/** One validated configuration — the environment's values, defaults included. */
export type ConfigValues = z.infer<typeof configSchema>

/**
 * The strict read: the validated values, or a thrown `ZodError`. This is the
 * pipeline's path, and the reason a broken `.env` still fails a Run at startup.
 */
export function parseConfig(env: NodeJS.ProcessEnv): ConfigValues {
  return configSchema.parse(env)
}

/**
 * The tolerant read of an environment object: the validated values, or `null`
 * for "no usable configuration". Never throws, and never returns a half-filled
 * configuration — a missing or malformed key is the same outcome as an absent
 * `.env`.
 */
export function readConfig(env: NodeJS.ProcessEnv): ConfigValues | null {
  const result = configSchema.safeParse(env)
  return result.success ? result.data : null
}

/**
 * The project's `.env` read through the whole schema: the validated values, or
 * `null` when the file is missing, unreadable or does not satisfy the schema.
 *
 * This is the one answer to "is `.env` usable now". The process environment is
 * merged over the file's values — shell env wins, exactly the precedence
 * `dotenv/config` gives a Run — and every key is validated, defaulted ones
 * included, so a file that passes here cannot then throw in the Run's own parse.
 *
 * The file is only parsed here, never loaded into `process.env`: a Console that
 * pre-loaded it once at boot could not see a correction without a restart (#60).
 */
export function readProjectConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): ConfigValues | null {
  let text: string
  try {
    text = fs.readFileSync(path.join(projectRoot, '.env'), 'utf8')
  } catch {
    return null
  }
  return readConfig({ ...parseDotenv(text), ...env })
}

// ── the tree-relative values ──────────────────────────────────────

/**
 * Where a Run's data lives and the Browser session it reuses. Everything here
 * has a default, which is what lets the Console serve the Mirror, the Run log
 * directory and the Gallery state without a `.env`.
 */
export interface SiteConfig {
  sessionName: string
  imagesDir: string
  logDir: string
  galleryStateFile: string
  runCacheDir: string
}

/**
 * Resolve a configuration against a repository root. `values === null` keeps the
 * schema's defaults, so a Console with no usable `.env` still reads exactly the
 * Mirror and log directory the Run would write into, and never invents a second
 * set of locations.
 */
export function siteConfig(projectRoot: string, values: ConfigValues | null): SiteConfig {
  const imagesDir = path.resolve(projectRoot, values?.IMAGES_DIR ?? DEFAULT_IMAGES_DIR)
  return {
    sessionName: values?.SESSION_NAME ?? DEFAULT_SESSION_NAME,
    imagesDir,
    logDir: path.resolve(projectRoot, values?.LOG_DIR ?? DEFAULT_LOG_DIR),
    // The cross-run memory of the list, kept beside the mirror it describes
    // (docs/adr/0006); not a log, and deleted together with `images/`.
    galleryStateFile: path.join(imagesDir, GALLERY_STATE_FILE_NAME),
    // Where a Run materializes the Discovery script copy that `run-code
    // --filename` needs. Gitignored, and the one directory in this tree that
    // only the crawler reads: the copy is written when its content changes and
    // never deleted.
    runCacheDir: path.resolve(projectRoot, RUN_CACHE_DIR_NAME),
  }
}

/**
 * The site's own Gallery list endpoint, derived from the origin so the two
 * cannot drift (docs/adr/0006). `readProjectConfig`'s `null` is what makes the
 * Console's endpoint absent — there is no URL to build without an origin.
 */
export function galleryListUrlOf(baseOrigin: string): string {
  return `${baseOrigin}${GALLERY_LIST_PATH}`
}
