// ── The one version a release is called (#79, #86) ──────────────────
//
// `package.json` is the only place a version number exists in this repository.
// `scripts/build.ts` injects it into the bundles, and `scripts/package.ts` names
// the archive after it. Both read it through this module so "the version" cannot
// become two literals that disagree — which is the failure mode a release named
// `…-v1.0.0.zip` whose status payload answers `0.9.0` would present.

import * as fs from 'node:fs'

/**
 * The release's version from `package.json`, or a failure.
 *
 * Read, never written. A missing or blank version is not "unknown"; a build or a
 * package must not produce an artifact that reports no version at all, because
 * that is the number a reader quotes in a bug report.
 */
export function packageVersion(file: string): string {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  const version =
    typeof parsed === 'object' && parsed !== null && 'version' in parsed
      ? parsed.version
      : undefined
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error(`${file} carries no version`)
  }
  return version.trim()
}
