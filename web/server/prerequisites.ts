// ── The pipeline's global prerequisites, checked before a Run starts ─
//
// A Run needs one thing a source checkout does not guarantee: a usable layered
// configuration. A missing `.env` throws a `ZodError` at module load before any
// record is written, so the start checks it here and turns it into a stable code
// the page can name in the reader's language (#47).
//
// #76 removed the two machine-shaped checks with the browser crawl they served:
// `@playwright/cli` on `PATH`, and Chrome through the registry's App Paths entry.
// A Run no longer launches a browser, so neither can be missing.
//
// #84 removed `tsx-entry`: the Console no longer starts a Run through a
// transpiler, so there is no loader to look for. The built Run entry beside the
// Console entry is a build artifact — a tree without it is a broken build, and
// the start's own boot refuses that (`web/server/build-artifacts.ts`) instead of
// letting a click reach an ENOENT nobody sees.
//
// Notes on what remains:
//   - The configuration is the layered pair (the app's `.env` and the user's
//     `data/user.env`), read through `core/config-read.ts`'s file-reading
//     predicate: dotenv's own parser, the process environment merged over the
//     files' values (shell env wins, as `dotenv/config` gave a Run), and the
//     whole schema a Run parses — defaulted keys included — so a layered
//     configuration usable here cannot then fail a Run at startup. `core/config.ts`
//     itself is still not imported: it parses the environment at import time and
//     would break the test suite's no-`.env` property.
//
// Nothing here launches a browser or runs a child process: the check is a file
// read.

import process from 'node:process'

import { dataRootOf } from '../../core/app-root.js'
import { readLayeredConfig } from '../../core/config-read.js'
import type { PrerequisiteCode } from '../api-types.js'

export interface PrerequisiteChecks {
  /** The layered configuration is usable: the whole schema a Run parses validates. */
  envFile: () => boolean
}

export interface PrerequisiteDeps {
  /** The application root: where `.env` is looked for. */
  appRoot: string
  /** The data root; defaults to the sibling `data` directory of `appRoot`. */
  dataRoot?: string
  /** Injected so a test can satisfy the checks without a real machine. */
  checks?: Partial<PrerequisiteChecks>
  /** The environment whose values the configuration check reads. */
  env?: NodeJS.ProcessEnv
}

const ORDER: readonly { name: PrerequisiteCode; key: keyof PrerequisiteChecks }[] = [
  { name: 'env-file', key: 'envFile' },
]

/**
 * The codes of the global prerequisites this machine is missing, in the notes'
 * order. Every check runs, so a start is refused with the whole gap named
 * rather than the first thing found.
 */
export function missingPrerequisites(deps: PrerequisiteDeps): PrerequisiteCode[] {
  const env = deps.env ?? process.env
  const real: PrerequisiteChecks = {
    envFile: () => runEnvFileAvailable(deps.appRoot, deps.dataRoot, env),
  }
  const checks: PrerequisiteChecks = { ...real, ...deps.checks }

  return ORDER.filter(({ key }) => !checks[key]()).map(({ name }) => name)
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
