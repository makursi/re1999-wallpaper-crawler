// ── The configuration schema, and the ways to read it ──────────────
//
// One schema, three reads, and one deliberate split from `core/config.ts`:
//
//   - `parseConfig` is the strict read. `core/config.ts` calls it at module load
//     and re-exports the values as the eager constants the pipeline imports, so
//     an absent or invalid configuration still throws before a Run starts.
//   - `readConfig` is the tolerant read of an environment object: the validated
//     values, or `null` for "no usable configuration".
//   - `readLayeredConfig` is the file-reading read. It takes the application
//     root as an explicit input (never derives it from this module's location),
//     reads the two layers and merges the process environment over them:
//
//       1. `<appRoot>/.env`      — the site constants shipped with the version
//       2. `<dataRoot>/user.env` — the user's personal overrides, optional
//       3. the schema's defaults
//
//     Precedence is user > app > defaults, and the process environment still
//     wins over every file, exactly as `dotenv/config` gave a Run before #78.
//
// The Console has to reach its page with no `.env` at all, and importing
// `core/config.ts` *is* the parse — so the Console imports this module instead
// (#57).
//
// The schema lives here and only here. So do the data-relative defaults
// (`siteConfig`), because a Console booting without any configuration still has
// to read the same Mirror and Run log directory a Run would — both under the
// injected data root (#80).

import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

import { parse as parseDotenv } from 'dotenv'
import { z } from 'zod'

import { dataRootOf } from './app-root.js'
import { dataLayoutOf, IMAGES_DIR_NAME, LOG_DIR_NAME } from './data-layout.js'

// ── configuration schema ──────────────────────────────────────────

// The schema's defaults, named: `siteConfig` has to resolve the same directories
// for a Console that never read a `.env`, so the fallbacks cannot be two literals.
const DEFAULT_IMAGES_DIR = IMAGES_DIR_NAME
const DEFAULT_LOG_DIR = LOG_DIR_NAME
const DEFAULT_BATCH_SIZE = 4
const APP_ENV_FILE_NAME = '.env'
const USER_ENV_FILE_NAME = 'user.env'
// The site's own gallery list path, relative to BASE_ORIGIN (docs/adr/0006).
const GALLERY_LIST_PATH = '/activity/official/websites/picture/query'

export const configSchema = z.object({
  BASE_ORIGIN: z.url(),
  IMAGES_DIR: z.string().min(1).default(DEFAULT_IMAGES_DIR),
  BATCH_SIZE: z.coerce.number().int().positive().max(20).default(DEFAULT_BATCH_SIZE),
  LOG_DIR: z.string().min(1).default(DEFAULT_LOG_DIR),
})

/** One validated configuration — the environment's values, defaults included. */
export type ConfigValues = z.infer<typeof configSchema>

/**
 * The strict read: the validated values, or a thrown `ZodError`. This is the
 * pipeline's path, and the reason a broken configuration still fails a Run at
 * startup.
 */
export function parseConfig(env: NodeJS.ProcessEnv): ConfigValues {
  return configSchema.parse(env)
}

/**
 * The tolerant read of an environment object: the validated values, or `null`
 * for "no usable configuration". Never throws, and never returns a half-filled
 * configuration — a missing or malformed key is the same outcome as an absent
 * file.
 */
export function readConfig(env: NodeJS.ProcessEnv): ConfigValues | null {
  const result = configSchema.safeParse(env)
  return result.success ? result.data : null
}

// ── the download's User-Agent ─────────────────────────────────────
//
// Not a schema key: it is a pure default with an environment override, so
// reading it cannot fail and it needs no eager parse. It lives in this module
// rather than `core/config.ts` so the download layer can take it as an injected
// value — and a test can import it without a usable configuration. The pipeline
// re-exports it from `core/config.ts`, so a Run sees one constant, not a copy.

export const USER_AGENT =
  process.env.USER_AGENT ??
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// ── the configuration files ───────────────────────────────────────

/** The two files a layered read consults, and the roots they sit under. */
export interface ConfigSources {
  /** The application root: the directory that holds `.env`, `core/` and `web/`. */
  appRoot: string
  /** The user's data directory, beside the application directory. */
  dataRoot: string
  /** The site constants shipped with the version. */
  appEnvFile: string
  /** The user's personal overrides; absent on a fresh install. */
  userEnvFile: string
}

/**
 * Name the two configuration files under one application root. The data root
 * is an explicit parameter so a caller (the Console's entry, a test) can point
 * at a different layout; without one it is the sibling `data` directory the
 * package ships (#78; #80 moves the rest of the user's data there).
 */
export function configSourcesOf(appRoot: string, dataRoot?: string): ConfigSources {
  const resolvedAppRoot = path.resolve(appRoot)
  const resolvedDataRoot = path.resolve(dataRoot ?? dataRootOf(resolvedAppRoot))
  return {
    appRoot: resolvedAppRoot,
    dataRoot: resolvedDataRoot,
    appEnvFile: path.join(resolvedAppRoot, APP_ENV_FILE_NAME),
    userEnvFile: path.join(resolvedDataRoot, USER_ENV_FILE_NAME),
  }
}

/** One file's parsed values, or `null` when it is absent or cannot be read. */
function readEnvFile(file: string): NodeJS.ProcessEnv | null {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  try {
    return parseDotenv(text)
  } catch {
    return null
  }
}

/** The one startup line that says the user's overrides were accepted. */
function userLayerNotice(file: string, keys: readonly string[]): string {
  return `config: user overrides loaded from ${file} (${keys.join(', ')})`
}

/** Everything a layered read found, usable or not. */
export interface LayeredConfigRead {
  /** The validated values, or `null` when no combination of layers is usable. */
  values: ConfigValues | null
  /**
   * The file values and the process environment merged in dotenv's precedence,
   * before the schema fills defaults. `core/config.ts` re-parses this object to
   * keep the pipeline's eager `ZodError` for an unusable configuration.
   */
  env: NodeJS.ProcessEnv
  /** Where the two files were looked for. */
  sources: ConfigSources
  /** The keys the user layer supplied, sorted; empty when it contributed nothing. */
  userKeys: readonly string[]
  /**
   * One line for the startup log when the user layer contributed to a usable
   * configuration, or `null`. A user file that is missing, empty or malformed
   * says nothing here: the Console's setup notice and the Run's own refusal are
   * what explain an unusable configuration.
   */
  notice: string | null
}

export interface LayeredConfigOptions {
  /** The application root. Required: this read never derives it. */
  appRoot: string
  /** The data root; defaults to the sibling `data` directory of `appRoot`. */
  dataRoot?: string
  /** The process environment, which wins over both files. */
  env?: NodeJS.ProcessEnv
}

/**
 * Read the two configuration layers through the whole schema.
 *
 * Degradation is deliberate and uniform: a missing file, an unreadable or
 * unparsable file, and a file that is missing a required key all come out as
 * `values: null`. The Console still boots and shows its setup notice; a Run
 * still fails at its own eager parse before it starts.
 *
 * The files are only parsed here, never loaded into `process.env`: a Console
 * that pre-loaded them once at boot could not see a correction without a
 * restart (#60).
 */
export function readLayeredConfig(options: LayeredConfigOptions): LayeredConfigRead {
  const sources = configSourcesOf(options.appRoot, options.dataRoot)
  const appValues = readEnvFile(sources.appEnvFile) ?? {}
  const userValues = readEnvFile(sources.userEnvFile) ?? {}
  const env: NodeJS.ProcessEnv = { ...appValues, ...userValues, ...(options.env ?? process.env) }
  const values = readConfig(env)
  const userKeys = Object.keys(userValues).toSorted()

  return {
    values,
    env,
    sources,
    userKeys,
    // "Loaded" means it contributed to a configuration the schema accepts; a
    // broken override must not be announced as if it had taken effect.
    notice:
      values !== null && userKeys.length > 0
        ? userLayerNotice(sources.userEnvFile, userKeys)
        : null,
  }
}

// ── the tree-relative values ──────────────────────────────────────

/**
 * Where a Run's data lives. Everything here has a default, which is what lets
 * the Console serve the Mirror, the Run log directory and the Gallery state
 * without any configuration.
 *
 * All of it is under the data directory, never the program directory: the
 * program is what an update replaces (#80). The data root itself is an injected
 * input from `core/app-root.ts`, not derived here.
 */
export interface SiteConfig {
  /** The user's data directory every other path is under. */
  dataRoot: string
  imagesDir: string
  logDir: string
  /** `<data>/cache/thumbnails`; disposable, and outside the Mirror (ADR 0010). */
  cacheDir: string
  galleryStateFile: string
}

/**
 * Resolve a configuration against the application root and the data root.
 * `values === null` keeps the schema's defaults, so a Console with no usable
 * configuration still reads exactly the Mirror and log directory the Run would
 * write into, and never invents a second set of locations.
 *
 * `dataRoot` is an explicit parameter for the reason `core/app-root.ts` gives:
 * a source tree keeps its data at `<repo>/data`, the package beside `<app>/`;
 * the two layouts cannot be told apart by one rule, so the entry point says
 * which one it is (#78, #80).
 */
export function siteConfig(
  appRoot: string,
  values: ConfigValues | null,
  dataRoot: string,
): SiteConfig {
  const layout = dataLayoutOf({
    appRoot,
    dataRoot,
    configuredImagesDir: values?.IMAGES_DIR,
    configuredLogDir: values?.LOG_DIR,
  })
  return {
    dataRoot: layout.dataRoot,
    imagesDir: layout.imagesDir,
    logDir: layout.logDir,
    cacheDir: layout.cacheDir,
    // The cross-run memory of the list, kept beside the mirror it describes
    // (docs/adr/0006); not a log, and deleted together with `images/`.
    galleryStateFile: layout.galleryStateFile,
  }
}

/**
 * The site's own Gallery list endpoint, derived from the origin so the two
 * cannot drift (docs/adr/0006). A `null` configuration is what makes the
 * Console's endpoint absent — there is no URL to build without an origin.
 */
export function galleryListUrlOf(baseOrigin: string): string {
  return `${baseOrigin}${GALLERY_LIST_PATH}`
}
