// ── Where the application lives ─────────────────────────────────────
//
// The application root is an input, not a deduction. Packaging collapses the
// source layout, so any code that derives "where am I" from its own module's
// depth breaks in the shipped tree — silently, because the page still opens and
// only a Run then cannot find its configuration (#78).
//
// The entry points (`core/main.ts`, `core/check-run.ts`,
// `web/server/console.ts`, and the launcher that starts a Run from the Console)
// resolve exactly one root with `resolveAppRoot`, and everything below them
// receives it: the Console injects it into its configuration value and into the
// Run child's environment, and the configuration reads take it as a parameter.
//
// `RE1999_APP_ROOT` is how a packaged launcher points at itself. A source run
// (`pnpm core:run`, `pnpm webui`) does not set it, so the entry point's explicit
// fallback — the process's working directory, which the package scripts set to
// the repository root — is used instead. Neither source is a module location.
//
// The data directory is a second input rather than a deduction, because the two
// layouts differ: a source tree keeps its data at `<repo>/data` (a child of the
// root), while the package keeps it beside the program at `<install>/data` (a
// sibling of `<install>/app`). One rule cannot serve both — "the sibling of the
// application root" would put a source run's Mirror outside the repository.
// So `RE1999_DATA_ROOT` is the package's answer, and the child of the root is
// the source tree's default.

import * as path from 'node:path'
import process from 'node:process'

/** The environment variable a packaged launcher sets to its own directory. */
export const APP_ROOT_ENV = 'RE1999_APP_ROOT'

/** The environment variable a packaged launcher sets to the data directory. */
export const DATA_ROOT_ENV = 'RE1999_DATA_ROOT'

/**
 * Resolve the one application root: the environment's `RE1999_APP_ROOT` when it
 * names one, otherwise the caller's explicit default.
 *
 * The fallback is a parameter rather than an implicit `process.cwd()` so the
 * entry points own the decision, and so a test can prove the environment wins
 * over a decoy working directory. An empty or whitespace-only value is silent,
 * exactly as an absent one.
 */
export function resolveAppRoot(env: NodeJS.ProcessEnv = process.env, fallback?: string): string {
  const configured = env[APP_ROOT_ENV]?.trim()
  if (configured !== undefined && configured.length > 0) return path.resolve(configured)
  return path.resolve(fallback ?? process.cwd())
}

/**
 * The data directory: `RE1999_DATA_ROOT` when the environment names one, which
 * is how the package's `<install>\data` (a sibling of `<install>\app`) is
 * declared, otherwise a `data` child of the application root, which is where a
 * source tree keeps it.
 *
 * Never the sibling by deduction: a source run's root *is* the repository, so a
 * sibling rule would place the Mirror beside the checkout. The packaged tree
 * must therefore say where its data is; `<app>\data` would be inside the
 * directory an update replaces, which is the one place it must never be.
 *
 * The user's own configuration (`data/user.env`) has lived here since #78; #80
 * puts the Mirror, the Run logs and the thumbnail cache in the same place, under
 * the arrangement `core/data-layout.ts` owns.
 */
export function dataRootOf(appRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[DATA_ROOT_ENV]?.trim()
  if (configured !== undefined && configured.length > 0) return path.resolve(configured)
  return path.resolve(appRoot, 'data')
}
