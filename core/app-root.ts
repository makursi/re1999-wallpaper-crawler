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
// The shipped release is a flat install root (spec #116): `npm start` runs
// `node server.js` with the package root as the working directory, so the entry
// point's explicit fallback — the process's working directory — is the root
// itself, with no environment variable set:
//
//   - `npm start` in a program directory, and `pnpm webui` over `build/` (#84),
//     both run in a tree that is its own application root;
//   - `pnpm core:run` (`tsx core/main.ts`) runs at the repository root.
//
// `RE1999_APP_ROOT` / `RE1999_DATA_ROOT` remain the override for a caller that
// has to point somewhere else (`pnpm webui` supplies both, as tests do); a
// shipped start names neither. The root is never a module location:
// `core/version.ts` no longer reads a bundle's own depth, and nothing else may
// start to.
//
// The data directory follows the same rule: `<appRoot>/data`, a child of the
// root, in a source checkout and in the program directory alike — one rule
// instead of two. `RE1999_DATA_ROOT` is only the override for a caller whose
// data is elsewhere.

import * as path from 'node:path'
import process from 'node:process'

/** The environment variable a caller sets to override the application root. */
export const APP_ROOT_ENV = 'RE1999_APP_ROOT'

/** The environment variable a caller sets to override the data directory. */
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
 * is how `pnpm webui` points the built tree at the repository's own `data/`,
 * otherwise a `data` child of the application root — the default the source run
 * and the program directory share.
 *
 * The child-by-default rule is what makes the flat install root work: the
 * program and its data sit in one directory, and `npm start`'s working directory
 * names it (#117). The override exists because a development start has its
 * program in `build\` and its data in the repository; a shipped start needs
 * neither.
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
