#!/usr/bin/env node
// ── The package: one command, one zip, and its root *is* the program ─
//
// `pnpm package` is `pnpm build` followed by this file. The archive it produces
// is the flat, npm-delivered release of spec #116 — extracted, its root is the
// program root, not a wrapper around one:
//
//   <archive root>\
//     README.md            the repository's one product document
//     LICENSE.txt          packaging\LICENSE.txt
//     package.json         build\package.json — the shipped manifest (#117)
//     package-lock.json    GENERATED here, against that manifest
//     .npmrc               GENERATED: engine-strict=true
//     .env                 GENERATED from packaging\site.env
//     server.js, run.js    build\ (#84)
//     web\dist\**          build\web\dist — the page
//
// **This is the packager's one network step**, and it is deliberate. The
// lockfile is not committed: a second lockfile in the repository would be a
// second truth about what the release installs, and it would drift from the
// manifest the build writes. So the step seeds a temporary directory with that
// manifest's own text, runs npm there with `--package-lock-only` (resolve only —
// no `node_modules` is written), reads `package-lock.json` back, checks it names
// the manifest's dependencies, and plans it as an in-memory entry. A packaging
// machine therefore needs a reachable registry; when it is not reachable this
// command fails and names the step, rather than shipping a package whose
// `npm install` would resolve something else entirely.
//
// Everything else here is copying and refusing. The archive is a whitelist, not
// a directory copy: the entries are planned one by one, `assertPackagedPaths`
// checks the plan's actual archive paths against `scripts/package-layout.ts`
// before the zip is opened, and the command fails with every offending path
// named. The owner's repository `.env` is never read — the only configuration
// that can enter the archive is the text of `packaging\site.env`.
//
// Two further assertions are deliberate: the plan's *sources* are checked so a
// stray owner file cannot be smuggled in behind a legal archive name, and the
// built tree's version has to equal the release's, so the zip's file name, the
// bundles' injected version and the archive's `package.json` are one number.
//
// Written with Node's own zlib (`scripts/zip.ts`) rather than a dependency: the
// package is assembled on a maintainer's machine, then extracted on one that has
// nothing but Node and npm.

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

import { buildArtifactRefusal, SERVER_ENTRY_FILE } from '../web/server/build-artifacts.js'
import {
  ARCHIVE_ENTRY_FILES,
  archiveRequiredEntries,
  assertPackagedPaths,
  LOCKFILE_FILE_NAME,
  lockfileCommand,
  lockfileRefusal,
  NPMRC_FILE_NAME,
  NPMRC_TEXT,
  readSiteEnv,
} from './package-layout.js'
import { shippedDependenciesOf } from './package-manifest.js'
import { packageVersion } from './package-version.js'
import type { ZipEntrySource } from './zip.js'
import { writeZip } from './zip.js'

/** The repository root: this script's parent. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..')

/** The built program (#84) — the archive root's entries, byte for byte. */
const BUILD_DIR = path.join(REPO_ROOT, 'build')

/** The manifest the build writes (#117); the archive ships it and locks it. */
const SHIPPED_MANIFEST = path.join(BUILD_DIR, 'package.json')

/** The page's build, inside the built tree. */
const PAGE_DIST = path.join(BUILD_DIR, 'web', 'dist')

/** The committed site constants and the licence's home. */
const PACKAGING_DIR = path.join(REPO_ROOT, 'packaging')

/** The archive's licence: shipped as `LICENSE.txt`, taken from `packaging\`. */
const LICENCE_FILE = path.join(PACKAGING_DIR, 'LICENSE.txt')

/** The one document a person opening the archive reads (#121 owns its words). */
const README_FILE = path.join(REPO_ROOT, 'README.md')

/** Where the release's zip is written; gitignored, and never source. */
const DIST_PACKAGE_DIR = path.join(REPO_ROOT, 'dist-package')

/** The archive a release uploads: `dist-package\re1999-wallpaper-crawler-v<version>.zip`. */
const ARCHIVE_BASE_NAME = 're1999-wallpaper-crawler'

/** The owner's local configuration; the packager must never read it. */
const OWNER_ENV_FILE = path.join(REPO_ROOT, '.env')

/** The data directory, which is never in an archive. */
const OWNER_DATA_DIR = path.join(REPO_ROOT, 'data')

/** One planned archive entry: where it goes, where it comes from, how big it is. */
interface PlannedFile {
  archivePath: string
  source: ZipEntrySource
  bytes: number
}

/** Whether a resolved path is the directory itself or somewhere under it. */
function isInside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Collect one directory tree into the plan, following links inside the page but
 * never into a nested `node_modules\` or a `.bin\` shim.
 *
 * The page is Vite's output and holds neither, but the rule is here so a future
 * directory can be collected with the same guard rather than re-deriving it. The
 * visited set is real paths, so a link that points back up cannot loop.
 */
function collectTree(
  root: string,
  archivePrefix: string,
  plan: PlannedFile[],
  visited: Set<string>,
): void {
  const realRoot = fs.realpathSync(root)
  if (visited.has(realRoot)) return
  visited.add(realRoot)

  for (const entry of fs.readdirSync(realRoot, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.bin') continue
    const full = path.join(realRoot, entry.name)
    const stat = entry.isSymbolicLink() ? fs.statSync(full) : entry
    const archivePath = `${archivePrefix}/${entry.name}`
    if (stat.isDirectory()) {
      collectTree(full, archivePath, plan, visited)
    } else if (stat.isFile()) {
      addFile(plan, archivePath, full)
    }
  }
}

/** Plan one real file, and check it is there before the zip is committed. */
function addFile(plan: PlannedFile[], archivePath: string, sourceFile: string): void {
  const stat = fs.statSync(sourceFile)
  if (!stat.isFile()) throw new Error(`package: ${sourceFile} is not a file`)
  plan.push({ archivePath, source: { name: archivePath, file: sourceFile }, bytes: stat.size })
}

/** Plan one entry whose bytes this script produced, not a file it copied. */
function addGenerated(plan: PlannedFile[], archivePath: string, text: string): void {
  const data = Buffer.from(text, 'utf8')
  plan.push({ archivePath, source: { name: archivePath, data }, bytes: data.length })
}

/**
 * A built tree or a failure. The Console's boot refusal names a missing Run
 * entry and page; `server.js` and `package.json` are checked here as well,
 * because a package is the one consumer that can be missing them without the
 * Console itself noticing.
 */
function assertBuildTree(version: string): void {
  const refusal = buildArtifactRefusal({ appRoot: BUILD_DIR, distDir: PAGE_DIST })
  if (refusal !== null) throw new Error(refusal.message)

  for (const file of [SERVER_ENTRY_FILE, 'package.json']) {
    const full = path.join(BUILD_DIR, file)
    if (!fs.existsSync(full)) {
      throw new Error(`package: build/${file} is missing — run pnpm build before packaging`)
    }
  }
  const builtVersion = packageVersion(SHIPPED_MANIFEST)
  if (builtVersion !== version) {
    throw new Error(
      `package: build/package.json is ${builtVersion} but the release is ${version} — run pnpm build`,
    )
  }
}

/** The shipped manifest's dependency map, read through the module that owns its shape. */
function shippedDependencies(manifestText: string): Record<string, string> {
  const dependencies = shippedDependenciesOf(JSON.parse(manifestText))
  if (dependencies === null) {
    throw new Error('package: build/package.json declares no dependencies — run pnpm build')
  }
  return dependencies
}

/**
 * Resolve the shipped manifest into `package-lock.json`, in a directory thrown
 * away afterwards, and hand back the text the archive carries.
 *
 * `shell: true` because npm on Windows is a `.cmd`, and a `.cmd` cannot be
 * spawned without a shell; `stdio: 'inherit'` because the child prints its own
 * progress and a packaging log wants to see it. The failure names this step: a
 * registry the machine cannot reach is the one thing that stops this command.
 */
function generateLockfile(manifestText: string): string {
  const seed = fs.mkdtempSync(path.join(os.tmpdir(), 're1999-package-lock-'))
  const command = lockfileCommand()
  try {
    fs.writeFileSync(path.join(seed, 'package.json'), manifestText, 'utf8')

    const result = spawnSync(command, { cwd: seed, shell: true, stdio: 'inherit' })
    if (result.error !== undefined || result.status !== 0) {
      const outcome =
        result.error !== undefined
          ? `could not be started (${result.error.message})`
          : `exited ${result.status === null ? 'without a status' : String(result.status)}`
      throw new Error(
        [
          `package: generating ${LOCKFILE_FILE_NAME} failed — \`${command}\` ${outcome}.`,
          "This is the packager's one network step: it resolves the manifest's runtime dependencies",
          'from the registry. Check that the registry is reachable (and npm’s proxy/cache settings),',
          'then run pnpm package again. No archive was written.',
        ].join(' '),
      )
    }

    const file = path.join(seed, LOCKFILE_FILE_NAME)
    if (!fs.existsSync(file)) {
      throw new Error(
        `package: generating ${LOCKFILE_FILE_NAME} failed — \`${command}\` exited 0 but wrote no ${LOCKFILE_FILE_NAME}. No archive was written.`,
      )
    }
    return fs.readFileSync(file, 'utf8')
  } finally {
    fs.rmSync(seed, { recursive: true, force: true })
  }
}

/** Plan every entry the release contains, and nothing else. */
function planArchive(version: string): { plan: PlannedFile[]; templateFile: string } {
  assertBuildTree(version)
  const template = readSiteEnv(PACKAGING_DIR)
  const manifestText = fs.readFileSync(SHIPPED_MANIFEST, 'utf8')

  const lockfileText = generateLockfile(manifestText)
  const lockfileProblem = lockfileRefusal(lockfileText, shippedDependencies(manifestText))
  if (lockfileProblem !== null) {
    throw new Error(
      `package: the generated ${LOCKFILE_FILE_NAME} is not the shipped manifest's — ${lockfileProblem}. ` +
        'The archive would install something other than what was built. No archive was written.',
    )
  }

  const plan: PlannedFile[] = []

  // The named root entries, each from its one source. There is no generic rule
  // any more: a root entry is a line in `scripts/package-layout.ts` and a line
  // here, argued for twice.
  addFile(plan, 'README.md', README_FILE)
  addFile(plan, 'LICENSE.txt', LICENCE_FILE)
  addFile(plan, 'package.json', SHIPPED_MANIFEST)
  addGenerated(plan, LOCKFILE_FILE_NAME, lockfileText)
  addGenerated(plan, NPMRC_FILE_NAME, NPMRC_TEXT)
  // The generated configuration, from the committed template's text. This is the
  // single most important line in the ticket: the repository's own `.env` is the
  // owner's, and it is never read here.
  addGenerated(plan, '.env', template.text)

  // The program: the two entries, and the page under `web/dist`.
  for (const name of ARCHIVE_ENTRY_FILES) {
    addFile(plan, name, path.join(BUILD_DIR, name))
  }
  collectTree(PAGE_DIST, 'web/dist', plan, new Set())

  return { plan, templateFile: template.file }
}

/**
 * The release's version, from `package.json` through the same reader
 * `scripts/build.ts` uses — never a second hand-written literal.
 */
function releaseVersion(): string {
  return packageVersion(path.join(REPO_ROOT, 'package.json'))
}

/** The archive's path for a version. */
function archivePathOf(version: string): string {
  return path.join(DIST_PACKAGE_DIR, `${ARCHIVE_BASE_NAME}-v${version}.zip`)
}

/** `12.3 MB`, for the report. */
function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The assertions that make the whitelist a fact:
 *
 *   1. every planned archive path is in the allow-list (the packager's own list);
 *   2. the required entries are present — a package without its document,
 *      manifest, lockfile, npm configuration, generated configuration, entries or
 *      page is broken even if every path is legal;
 *   3. no entry's *source* is the owner's `.env` or under the data directory,
 *      which is defence in depth behind the path rule;
 *   4. the template that became `.env` is the committed one.
 */
function assertArchivePlan(plan: readonly PlannedFile[], templateFile: string): void {
  assertPackagedPaths(plan.map(entry => entry.archivePath))

  const present = new Set(plan.map(entry => entry.archivePath))
  const missing = archiveRequiredEntries().filter(archivePath => !present.has(archivePath))
  if (missing.length > 0) {
    throw new Error(
      `package: the archive would be incomplete — missing:\n${missing
        .map(archivePath => `  ${archivePath}`)
        .join('\n')}`,
    )
  }

  for (const entry of plan) {
    if (!('file' in entry.source)) continue
    const sourceFile = path.resolve(entry.source.file)
    if (sourceFile === OWNER_ENV_FILE) {
      throw new Error(
        'package: refusing to ship the working tree .env — the archive .env comes from packaging/site.env',
      )
    }
    if (isInside(sourceFile, OWNER_DATA_DIR)) {
      throw new Error(`package: refusing to ship a file from the data directory: ${sourceFile}`)
    }
  }

  if (!isInside(path.resolve(templateFile), PACKAGING_DIR)) {
    throw new Error(`package: the .env was not generated from packaging/site.env (${templateFile})`)
  }
}

/** Remove earlier archives of this name, leaving anything else in the directory alone. */
function clearPreviousArchive(): void {
  for (const name of fs.readdirSync(DIST_PACKAGE_DIR)) {
    if (name.startsWith(`${ARCHIVE_BASE_NAME}-v`) && name.endsWith('.zip')) {
      fs.rmSync(path.join(DIST_PACKAGE_DIR, name), { force: true })
    }
  }
}

/** What the archive looks like at a glance: its root entries and its size. */
function report(
  plan: readonly PlannedFile[],
  archive: string,
  zipBytes: number,
  sourceBytes: number,
): void {
  const topLevel = new Map<string, { files: number; bytes: number }>()
  for (const entry of plan) {
    const key = entry.archivePath.split('/')[0] ?? entry.archivePath
    const bucket = topLevel.get(key) ?? { files: 0, bytes: 0 }
    bucket.files += 1
    bucket.bytes += entry.bytes
    topLevel.set(key, bucket)
  }

  process.stdout.write(`package: ${path.relative(REPO_ROOT, archive).replaceAll('\\', '/')}\n`)
  for (const [name, bucket] of topLevel) {
    const suffix = bucket.files === 1 ? '1 file' : `${bucket.files} files`
    process.stdout.write(`package: top level — ${name} (${suffix}, ${megabytes(bucket.bytes)})\n`)
  }
  process.stdout.write(
    `package: ${plan.length} files, ${megabytes(sourceBytes)} unpacked, ${megabytes(zipBytes)} zip\n`,
  )
  process.stdout.write(
    `package: whitelist ok — ${plan.length} archive paths, none outside scripts/package-layout.ts\n`,
  )
}

/** The command: version, plan, assert, write one zip, report. */
function main(): void {
  const version = releaseVersion()
  const { plan, templateFile } = planArchive(version)
  assertArchivePlan(plan, templateFile)

  fs.mkdirSync(DIST_PACKAGE_DIR, { recursive: true })
  const archive = archivePathOf(version)
  // Write beside the final name and rename only after the archive is complete:
  // a failed run leaves the previous release in place, never a half-zip that
  // looks like one.
  const partial = `${archive}.partial`
  const written = writeZip(
    partial,
    plan.map(entry => entry.source),
  )
  clearPreviousArchive()
  fs.renameSync(partial, archive)

  report(plan, archive, written.zipBytes, written.sourceBytes)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
