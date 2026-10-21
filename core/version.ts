// ── The one current version ─────────────────────────────────────────
//
// A reader reporting a problem in a chat group needs to say which build they
// run, so exactly one module owns the number (#79). It resolves, in order:
//
//   1. the value the build injects — ticket #84 bundles the packaged tree and
//      points the `define` seam below at the release's version;
//   2. the application's own package metadata, read relative to the application
//      root. The root is an explicit input, the value `core/app-root.ts`
//      resolved at the entry point, exactly as `core/config-read.ts` takes it —
//      never this module's file position, which packaging collapses.
//
// `package.json` stays the source of truth for a source run. Nothing else in
// the repository writes a version number: the status payload carries this
// module's answer, and the page shows it (`web/api-types.ts` ›
// `ConsoleStatusPayload.version`), so the two cannot be different numbers.

import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * The identifier a bundled build replaces with a string literal.
 *
 * A bundler `define` (ticket #84) maps `RE1999_VERSION` to the release's
 * version, e.g. `define: { RE1999_VERSION: JSON.stringify(version) }`. A source
 * run never defines it, and `typeof` on an undeclared identifier is
 * `'undefined'` rather than a `ReferenceError`, which is the runtime fallback.
 */
declare const RE1999_VERSION: string | undefined

/**
 * The build-time version, when the bundle carries one; `undefined` in a source
 * run. A blank injection is treated as absent so a misconfigured `define`
 * cannot publish an empty version.
 */
export const BUILD_VERSION: string | undefined =
  typeof RE1999_VERSION === 'string' && RE1999_VERSION.trim() !== '' ? RE1999_VERSION : undefined

/** The file that declares a source run's version, relative to the app root. */
const PACKAGE_FILE = 'package.json'

/**
 * The current version, given what the build injected and the application root.
 *
 * The injected value wins outright; otherwise the root's `package.json` is
 * read. `null` when neither names a version — an install whose metadata is
 * unreadable reports "no version" rather than inventing one.
 */
export function resolveVersion(injected: string | undefined, appRoot: string): string | null {
  const build = injected?.trim()
  if (build !== undefined && build.length > 0) return build
  return versionFromPackage(path.join(appRoot, PACKAGE_FILE))
}

/**
 * The version this application is running: `resolveVersion` with the build's
 * own injection and the root the caller resolved via `core/app-root.ts`.
 */
export function applicationVersion(appRoot: string): string | null {
  return resolveVersion(BUILD_VERSION, appRoot)
}

/** The `version` of one package metadata file, or `null` when it cannot be read. */
function versionFromPackage(packageFile: string): string | null {
  let text: string
  try {
    text = fs.readFileSync(packageFile, 'utf8')
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) return null
  const { version } = parsed
  return typeof version === 'string' && version.trim() !== '' ? version.trim() : null
}
