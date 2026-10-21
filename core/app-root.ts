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

import * as path from 'node:path'
import process from 'node:process'

/** The environment variable a packaged launcher sets to its own directory. */
export const APP_ROOT_ENV = 'RE1999_APP_ROOT'

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
 * The data directory that sits beside the application directory: the packaged
 * layout is `<install>\app` and `<install>\data`. The user's own configuration
 * (`data/user.env`) lives there from #78 on; #80 moves the Mirror, the Run logs
 * and the thumbnail cache into the same directory.
 */
export function dataRootOf(appRoot: string): string {
  return path.resolve(appRoot, '..', 'data')
}
