// ── The pipeline's global prerequisites, checked before a Run starts ─
//
// The Run dies cryptically when one of these is missing: `pwc('close-all')` and
// `pwc('delete-data')` swallow a failed `playwright-cli` silently, so the Run
// only fails later at `pwc('open …')`, and a missing `.env` throws a `ZodError`
// at module load before any record is written. Checking the four here turns each of
// those into a stable code the page can name in the reader's language (#47).
//
// Notes on the two machine-shaped checks:
//   - Chrome is looked up through the registry's App Paths entry, because the
//     Playwright config asks for the `chrome` channel: the `ms-playwright`
//     chromium under `%LOCALAPPDATA%` is present but is not what a Run uses.
//   - The configuration is the layered pair (the app's `.env` and the user's
//     `data/user.env`), read through `core/config-read.ts`'s file-reading
//     predicate: dotenv's own parser, the process environment merged over the
//     files' values (shell env wins, as `dotenv/config` gave a Run), and the
//     whole schema a Run parses — defaulted keys included — so a layered
//     configuration usable here cannot then fail a Run at startup. `core/config.ts`
//     itself is still not imported: it parses the environment at import time and
//     would break the test suite's no-`.env` property.
//
// Nothing here launches a browser or runs `playwright-cli`: the checks are a
// PATH scan, a registry read, a file read and a file existence test.

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

import { dataRootOf } from '../../core/app-root.js'
import { readLayeredConfig } from '../../core/config-read.js'
import type { PrerequisiteCode } from '../api-types.js'

export interface PrerequisiteChecks {
  /** The globally installed `@playwright/cli`, found on `PATH`. */
  playwrightCli: () => boolean
  /** Real Chrome, via the registry's App Paths entry (the `chrome` channel). */
  chrome: () => boolean
  /** The layered configuration is usable: the whole schema a Run parses validates. */
  envFile: () => boolean
  /** `<appRoot>/node_modules/tsx/dist/cli.mjs`, the Run's loader entry. */
  tsxEntry: () => boolean
}

export interface PrerequisiteDeps {
  /** The application root: where `.env` and `node_modules` are looked for. */
  appRoot: string
  /** The data root; defaults to the sibling `data` directory of `appRoot`. */
  dataRoot?: string
  /** Injected so a test can satisfy the checks without a real machine. */
  checks?: Partial<PrerequisiteChecks>
  /** The environment whose `PATH` and `PATHEXT` are read. */
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

const ORDER: readonly { name: PrerequisiteCode; key: keyof PrerequisiteChecks }[] = [
  { name: 'playwright-cli', key: 'playwrightCli' },
  { name: 'chrome', key: 'chrome' },
  { name: 'env-file', key: 'envFile' },
  { name: 'tsx-entry', key: 'tsxEntry' },
]

/** `<appRoot>/node_modules/tsx/dist/cli.mjs` — the Run's argv slot 2. */
export function tsxEntryPath(appRoot: string): string {
  return path.join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

/**
 * The codes of the global prerequisites this machine is missing, in the notes'
 * order. Every check runs, so a start is refused with the whole gap named
 * rather than the first thing found.
 */
export function missingPrerequisites(deps: PrerequisiteDeps): PrerequisiteCode[] {
  const env = deps.env ?? process.env
  const platform = deps.platform ?? process.platform
  const real: PrerequisiteChecks = {
    playwrightCli: () => onPath(['playwright-cli'], env, platform),
    chrome: () => realChrome(env, platform),
    envFile: () => runEnvFileAvailable(deps.appRoot, deps.dataRoot, env),
    tsxEntry: () => fs.existsSync(tsxEntryPath(deps.appRoot)),
  }
  const checks: PrerequisiteChecks = { ...real, ...deps.checks }

  return ORDER.filter(({ key }) => !checks[key]()).map(({ name }) => name)
}

/** Whether one of `names` is an executable on the environment's `PATH`. */
function onPath(
  names: readonly string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): boolean {
  const pathValue = env.PATH ?? env.Path ?? ''
  const dirs = pathValue.split(path.delimiter).filter(dir => dir.length > 0)
  // On Windows npm installs a `.cmd` and a `.ps1` shim beside the bare name; a
  // shell finds the command through one of them, so all of them count.
  const suffixes =
    platform === 'win32' ? ['', '.ps1', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')] : ['']
  return dirs.some(dir =>
    names.some(name => suffixes.some(suffix => fs.existsSync(path.join(dir, name + suffix)))),
  )
}

const CHROME_APP_PATH_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
]

/**
 * Real Chrome: the registry's App Paths entry, whose default value is the
 * `chrome.exe` Playwright's `chrome` channel launches. The bundled
 * `ms-playwright` chromium is deliberately not accepted — the config asks for
 * the channel, so a Run cannot use it.
 */
function realChrome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') {
    return onPath(
      ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
      env,
      platform,
    )
  }
  for (const key of CHROME_APP_PATH_KEYS) {
    const executable = registryDefaultValue(key)
    if (executable !== null && fs.existsSync(executable)) return true
  }
  return false
}

/**
 * One registry key's default value, or `null`. `reg.exe` is part of Windows, so
 * this is a cheap read; it starts nothing and launches no browser.
 */
function registryDefaultValue(key: string): string | null {
  try {
    const output = execFileSync('reg', ['query', key, '/ve'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    // "    (Default)    REG_SZ    C:\Program Files\Google\Chrome\Application\chrome.exe"
    const match = /REG_SZ\s+(.+?)\s*$/m.exec(output)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * Whether the layered configuration is usable *now*: some combination of the
 * app's `.env`, the user's `data/user.env` and the process environment satisfies
 * the whole schema a Run parses, defaulted keys included.
 *
 * Exported because two surfaces ask this one question (#60): the start refuses
 * with the `env-file` prerequisite when it is `false`, and `/api/status` reports
 * it as `runConfigAvailable` so the page's setup notice clears on the next
 * status read — without a Console restart, and without the ambient notice and
 * the click path ever reaching different answers.
 *
 * `dataRoot` is optional so a caller that names only the app root still gets the
 * packaged sibling layout; the Console passes the root it resolved explicitly.
 */
export function runEnvFileAvailable(
  appRoot: string,
  dataRoot?: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    readLayeredConfig({
      appRoot,
      dataRoot: dataRoot ?? dataRootOf(appRoot),
      env,
    }).values !== null
  )
}
