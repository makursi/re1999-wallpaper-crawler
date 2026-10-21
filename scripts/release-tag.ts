#!/usr/bin/env node
// ── The tag and package.json are one version (#88) ──────────────────
//
// A release is triggered by a tag, but everything inside the artifact is named
// by `package.json`: `scripts/build.ts` injects that version into the bundles,
// `scripts/package.ts` names the zip after it, and the page prints it. The tag
// is the maintainer's other hand, so it can disagree — a tag `v1.0.1` on a tree
// whose `package.json` still says `1.0.0` would draft a Release whose download
// reports a different version than the tag it was published as. The rule is
// therefore a refusal, not a warning, and it is a function with tests rather
// than a condition buried in YAML.
//
// CLI (the workflow's "resolve the version" step):
//
//   tsx scripts/release-tag.ts v1.0.0   # a tag push: refuse unless tag == package.json
//   tsx scripts/release-tag.ts --package # a workflow_dispatch dry run: no tag exists yet
//
// Both print the version on stdout and nothing else, so the caller can capture
// it; every failure goes to stderr and exits non-zero.
//
// `--package` deliberately skips the tag check: a dry run has no tag to check
// against, and it still exercises the rest of the pipeline with the version the
// real release would carry.

import * as path from 'node:path'
import process from 'node:process'

import { packageVersion } from './package-version.js'

/** The repository root: this script's parent. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..')

/** `package.json`, the one place a version number exists in this repository. */
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json')

/**
 * The version a tag names, or `null` when the tag is not `vX.Y.Z`.
 *
 * Strict on purpose: semver's numeric triple with no prerelease and no build
 * metadata, no leading zeros, and the `v` prefix the workflow triggers on. A
 * prerelease can be added as its own rule on the day this project ships one;
 * guessing at it now would make "the version" ambiguous in the archive.
 */
export function tagVersion(tag: string): string | null {
  if (tag !== tag.trim()) return null
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag)
  if (match === null) return null
  return `${match[1]}.${match[2]}.${match[3]}`
}

/**
 * The version to release, or a failure naming both numbers.
 *
 * Called before anything is built, so a disagreeing tag costs one short step
 * instead of a full Windows build.
 */
export function checkReleaseTag(tag: string, version: string): string {
  const tagged = tagVersion(tag)
  if (tagged === null) {
    throw new Error(
      `release: the tag "${tag}" is not vX.Y.Z — a release tag is exactly ` +
        `"v" followed by the three numbers in package.json (v1.0.0).`,
    )
  }
  if (tagged !== version) {
    throw new Error(
      `release: the tag "${tag}" says version ${tagged}, but package.json says ${version}. ` +
        'They are one number: bump package.json, commit, and tag that commit.',
    )
  }
  return tagged
}

/** The command: print the version the rest of the workflow should use. */
function main(argv: readonly string[]): void {
  const version = packageVersion(PACKAGE_JSON)
  const [first, ...rest] = argv

  if (rest.length > 0 || first === undefined) {
    throw new Error(
      'release: usage — tsx scripts/release-tag.ts <vX.Y.Z> | --package ' +
        '(the first checks the tag against package.json, the second is the dry run)',
    )
  }

  process.stdout.write(`${first === '--package' ? version : checkReleaseTag(first, version)}\n`)
}

// Run only as a command, so the tests can import the functions above. `tsx`
// executes this file (argv[1] is its path); vitest executes its own binary.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
