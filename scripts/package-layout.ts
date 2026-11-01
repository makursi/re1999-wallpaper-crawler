// ── What may enter the flat package (#118) ──────────────────────────
//
// The release's promise is still "the archive physically cannot carry the
// owner's data" — but the shape it is promised about changed with spec #116: the
// extracted root **is** the program root, there is no `app\` level, no bundled
// runtime, no `.bat` and no `node_modules\`. So the whitelist is no longer a
// predicate over directories: it is a short list of names plus one wildcard.
//
//   README.md          the one product document (#121 owns its words)
//   LICENSE.txt        packaging/LICENSE.txt
//   package.json       the shipped manifest the build writes (#117)
//   package-lock.json  generated at package time, never committed
//   .npmrc             generated: engine-strict=true
//   .env               generated from packaging/site.env, never the working tree's
//   server.js          the Console entry, from the build
//   run.js             the Run entry, from the build
//   web/dist/**        the page
//
// Everything else is refused *by shape*, which is the point: a runtime binary, a
// dependency tree, a data directory, a source file, a test, a build script, a
// repository document, a changelog, or a hidden development configuration has no
// name here, so no collector can put one in by accident. `update.js` is refused
// like any other unknown name: the flat package has no updater, and a program
// that still thought it updated itself would have no place in it.
//
// The predicate works on **archive-relative paths** (`web/dist/index.html`).
// That is the list `scripts/package.ts` actually collects, so asserting it is
// asserting the archive's real contents, not a second opinion about the source
// tree. A path with `\`, `..`, a drive letter or an empty segment is not an
// archive path at all and is refused before any rule gets to allow it.
//
// This module also owns the lockfile's two decisions, because the lockfile is the
// one archive entry that is neither copied nor formatted from a committed file:
// the command that generates it from the shipped manifest, and the check that
// what came back really is that manifest's lockfile.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { parse as parseDotenv } from 'dotenv'

import type { ConfigValues } from '../core/config-read.js'
import { readConfig } from '../core/config-read.js'
import { PAGE_ENTRY_FILE } from '../web/server/build-artifacts.js'

/** The name of the committed site-constants template, inside `packaging/`. */
export const SITE_ENV_FILE_NAME = 'site.env'

/** The two program entries the archive carries, taken from the built tree. */
export const ARCHIVE_ENTRY_FILES: readonly string[] = ['server.js', 'run.js']

/**
 * Every file that may live directly at the archive root, by name.
 *
 * A whitelist of names rather than extensions: a portable package used to pick
 * up every `.bat` and `.txt` in `packaging/` generically, and the flat root has
 * no such seam — adding a root entry is adding a line here and arguing for it.
 */
export const ARCHIVE_ROOT_FILES: readonly string[] = [
  'README.md',
  'LICENSE.txt',
  'package.json',
  'package-lock.json',
  '.npmrc',
  '.env',
  ...ARCHIVE_ENTRY_FILES,
]

/** The page's directory at the archive root: the one wildcard. */
const PAGE_DIR_SEGMENTS: readonly string[] = ['web', 'dist']

/** The page's entry document, as an archive path: `web/dist/index.html`. */
export const PAGE_ENTRY_ARCHIVE_PATH = [...PAGE_DIR_SEGMENTS, PAGE_ENTRY_FILE].join('/')

/** The generated npm configuration: the floor is enforced at install time too. */
export const NPMRC_FILE_NAME = '.npmrc'

/** The npm configuration's whole text. */
export const NPMRC_TEXT = 'engine-strict=true\n'

/** The lockfile's name, at the archive root. */
export const LOCKFILE_FILE_NAME = 'package-lock.json'

/** The npm executable the packager shells out to. */
const NPM_COMMAND = 'npm'

/**
 * The install that turns the shipped manifest into a lockfile, and nothing else.
 *
 * `--package-lock-only` resolves the tree without writing `node_modules` into the
 * seed directory; `--omit=dev` says the same thing about the dev half of the
 * manifest (there is none); `--no-audit` and `--no-fund` keep the packaging log
 * about packaging.
 */
export function lockfileInstallArgs(): readonly string[] {
  return ['install', '--package-lock-only', '--omit=dev', '--no-audit', '--no-fund']
}

/** The one shell command the lockfile step runs, in full, for the log. */
export function lockfileCommand(): string {
  return [NPM_COMMAND, ...lockfileInstallArgs()].join(' ')
}

/**
 * Split an archive-relative path into segments, or `null` when it is not one.
 *
 * The accepted shape is deliberately narrow: forward slashes only, no leading
 * slash, no Windows drive, no empty/`.`/`..` segment. A path that fails this is
 * not "outside the whitelist" in a subtle way — it is not a path this packager
 * produced, and allowing it to proceed would be allowing an extraction escape.
 */
export function archivePathSegments(archivePath: string): string[] | null {
  if (archivePath.length === 0) return null
  if (archivePath.includes('\\')) return null
  if (archivePath.startsWith('/')) return null
  if (/^[A-Za-z]:/.test(archivePath)) return null

  const segments = archivePath.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null
  return segments
}

/** Whether a segment list is a file somewhere under `web/dist`. */
function isPagePath(segments: readonly string[]): boolean {
  if (segments.length <= PAGE_DIR_SEGMENTS.length) return false
  return PAGE_DIR_SEGMENTS.every((segment, index) => segments[index] === segment)
}

/**
 * Whether one archive-relative path may enter the release.
 *
 * A root path must be one of the names above; anything deeper must be a file
 * under `web/dist`. That is the whole rule, and its blank side is the archive's
 * shape: no `app\`, no `node.exe`, no `node_modules\`, no `data\`, no `.bat`, no
 * `update.js`, and nothing from the repository's own tree.
 */
export function isPackagedPath(archivePath: string): boolean {
  const segments = archivePathSegments(archivePath)
  if (segments === null) return false

  if (segments.length === 1) return ARCHIVE_ROOT_FILES.includes(segments[0])
  return isPagePath(segments)
}

/** Every collected path the whitelist refuses, in the order they were collected. */
export function packagePathOffenders(archivePaths: readonly string[]): string[] {
  return archivePaths.filter(archivePath => !isPackagedPath(archivePath))
}

/**
 * The entries a package cannot be missing, on top of every path being legal.
 *
 * The named root files are the program's whole interface — its document, its
 * manifest and lockfile, its npm configuration, its generated configuration and
 * its two entries — plus the page's entry document. A package without any one of
 * them is broken even when the whitelist was obeyed.
 */
export function archiveRequiredEntries(): readonly string[] {
  return [...ARCHIVE_ROOT_FILES, PAGE_ENTRY_ARCHIVE_PATH]
}

/**
 * Assert the actual collected list against the whitelist, and fail loudly.
 *
 * Called before the zip is opened for writing, so an offender names itself and
 * the command exits non-zero with the archive absent — not a release that has to
 * be inspected later, and not a warning that scrolls away.
 */
export function assertPackagedPaths(archivePaths: readonly string[]): void {
  const offenders = packagePathOffenders(archivePaths)
  if (offenders.length === 0) return

  throw new Error(
    [
      'package: refusing to write an archive with paths outside the whitelist:',
      ...offenders.map(offender => `  ${offender}`),
      'Only scripts/package-layout.ts decides what a release may contain; add the rule there and argue for it.',
    ].join('\n'),
  )
}

/** The committed site-constants template, as read and as validated. */
export interface SiteEnvTemplate {
  /** The template file it was read from. */
  file: string
  /** Its text, which becomes the archive's `.env` byte for byte. */
  text: string
  /** The values the schema read out of it. */
  values: ConfigValues
  /** `BASE_ORIGIN`, the one key the schema requires. */
  baseOrigin: string
}

/**
 * Read `packaging\site.env` and make sure the configuration schema accepts it.
 *
 * A missing template is a failure, never a fallback to the working tree's
 * `.env`: that file is the owner's, it is gitignored, and copying it is exactly
 * how a release would carry the owner's local data. A template the schema
 * refuses is the same failure one step later.
 */
export function readSiteEnv(packagingDir: string): SiteEnvTemplate {
  const file = path.join(packagingDir, SITE_ENV_FILE_NAME)
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(
      `package: cannot read the site-constants template ${file} — ` +
        'a release generates its .env from this committed file, never from the working tree ' +
        `(${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    )
  }

  const values = readConfig(parseDotenv(text))
  if (values === null) {
    throw new Error(
      `package: ${SITE_ENV_FILE_NAME} is not a configuration the schema accepts; ` +
        'it must name at least BASE_ORIGIN (core/config-read.ts). ' +
        `The packaged ${SITE_ENV_FILE_NAME} is generated from this template and never copied from the working tree.`,
    )
  }

  return { file, text, values, baseOrigin: values.BASE_ORIGIN }
}

/** Whether an unknown value is a JSON object, the shape a lockfile is read as. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A lockfile's root descriptor: the manifest the lockfile was resolved from. */
function rootDependencies(packages: Record<string, unknown>): Record<string, unknown> | null {
  const root = packages['']
  if (!isRecord(root)) return null
  return isRecord(root.dependencies) ? root.dependencies : {}
}

/** Whether two dependency maps name the same packages at the same specs. */
function sameDependencies(
  left: Record<string, unknown>,
  right: Readonly<Record<string, string>>,
): string | null {
  const leftNames = Object.keys(left).toSorted()
  const rightNames = Object.keys(right).toSorted()
  if (leftNames.join() !== rightNames.join()) {
    return `it resolves ${leftNames.join(', ') || 'nothing'}, the manifest declares ${rightNames.join(', ')}`
  }
  for (const name of rightNames) {
    if (left[name] !== right[name]) {
      return `it pins ${name}@${String(left[name])}, the manifest declares ${right[name]}`
    }
  }
  return null
}

/**
 * Why the generated lockfile is not the shipped manifest's lockfile, or `null`.
 *
 * The archive carries one lockfile and one manifest, and `npm install` in an
 * extracted package trusts the pair. A lockfile resolved from a different
 * manifest — or one where a dependency never resolved — makes that install
 * download something other than what was built and tested, so the packager reads
 * the text back and checks it names this manifest's dependencies and a version
 * for each, before it plans the entry.
 */
export function lockfileRefusal(
  lockfileText: string,
  dependencies: Readonly<Record<string, string>>,
): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(lockfileText)
  } catch {
    return 'the file is not JSON'
  }
  if (!isRecord(parsed)) return 'the file is not a JSON object'
  if (typeof parsed.lockfileVersion !== 'number' || parsed.lockfileVersion < 2) {
    return 'it has no lockfileVersion npm can read'
  }

  const packages = parsed.packages
  if (!isRecord(packages)) return 'it has no packages map'
  const root = rootDependencies(packages)
  if (root === null) return 'it has no root package entry ("")'

  const mismatch = sameDependencies(root, dependencies)
  if (mismatch !== null) return mismatch

  for (const name of Object.keys(dependencies)) {
    const entry = packages[`node_modules/${name}`]
    if (!isRecord(entry) || typeof entry.version !== 'string' || entry.version.length === 0) {
      return `it does not resolve ${name}`
    }
  }

  return null
}
