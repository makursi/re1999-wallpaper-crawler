#!/usr/bin/env node
// ── The portable package: one command, one zip (#86) ────────────────
//
// `pnpm package` is `pnpm build` followed by this file. It assembles exactly the
// tree the specification's "制品形状" describes and refuses to produce anything
// else:
//
//   <archive root>\
//     启动.bat              from packaging\, byte for byte (CRLF, ASCII)
//     更新.bat / 使用说明.txt   whatever packaging\ holds when #87 and #89 land
//     app\
//       server.js, run.js, package.json, web\dist\   build/ (#84)
//       node.exe                                      the running Node (or #88's)
//       node_modules\sharp\, @img\, detect-libc, semver   sharp's runtime closure
//       .env                                          GENERATED from packaging\site.env
//
// **No `data\`.** The launcher creates it and the program owns it (#80, #85).
//
// The archive is a whitelist, not a directory copy (#75 story 33): the files are
// planned one by one, `assertPackagedPaths` checks the plan's actual archive
// paths against `scripts/package-layout.ts` before the zip is opened, and the
// command fails with every offending path named. The owner's repository `.env`
// is never read — the only configuration that can enter the archive is the text
// of `packaging\site.env`, written as `app\.env`.
//
// Two further assertions are deliberate: the plan's *sources* are checked so a
// stray owner file cannot be smuggled in behind a legal archive name, and the
// built tree's version has to equal the release's, so the zip's file name, the
// bundles' injected version and `app\package.json` are one number.
//
// Written with Node's own zlib (`scripts/zip.ts`) rather than a dependency: the
// package is built on a maintainer's machine, but the archive is opened on one
// that has nothing at all.

import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import process from 'node:process'

import { buildArtifactRefusal, SERVER_ENTRY_FILE } from '../web/server/build-artifacts.js'
import {
  APP_BUILD_FILES,
  assertPackagedPaths,
  nodeRuntimeFile,
  readSiteEnv,
  rootPackageFiles,
  RUNTIME_PACKAGES,
} from './package-layout.js'
import { packageVersion } from './package-version.js'
import type { ZipEntrySource } from './zip.js'
import { writeZip } from './zip.js'

/** The repository root: this script's parent. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..')

/** The built program (#84), the source of everything under `app\` but the runtime. */
const BUILD_DIR = path.join(REPO_ROOT, 'build')

/** The page's build, inside the built tree. */
const PAGE_DIST = path.join(BUILD_DIR, 'web', 'dist')

/** The one directory whose files become archive-root files (#87, #89). */
const PACKAGING_DIR = path.join(REPO_ROOT, 'packaging')

/** Where the release's zip is written; gitignored, and never source. */
const DIST_PACKAGE_DIR = path.join(REPO_ROOT, 'dist-package')

/** The archive a release uploads: `dist-package\re1999-wallpaper-crawler-v<version>.zip`. */
const ARCHIVE_BASE_NAME = 're1999-wallpaper-crawler'

/** The launcher #85 owns. An archive without it is not a package. */
const LAUNCHER_FILE = '启动.bat'

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
 * Collect one directory tree into the plan, following links inside third-party
 * packages but never into a nested `node_modules\` or a `.bin\` shim.
 *
 * pnpm stores a package's dependencies beside it and leaves `node_modules\.bin`
 * symlinks inside the package; those are install-time commands, not the
 * program's runtime, and following them would drag dev tooling into a release.
 * The visited set is real paths, so a link that points back up cannot loop.
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

/**
 * The package a runtime dependency resolves to, by its own metadata.
 *
 * `sharp` resolves its dependencies from its **real** pnpm directory, and one
 * of them (`@img/sharp-win32-x64`) exposes only subpath exports, so several
 * specifiers are tried before giving up. Walking up to the nearest `package.json`
 * is how a resolved file becomes its package root, and the name is checked so a
 * surprising resolution cannot quietly package the wrong directory.
 */
function runtimePackageDir(requireFromSharp: NodeJS.Require, name: string): string {
  const candidates = [name, `${name}/package.json`, `${name}/package`, `${name}/sharp.node`]
  for (const specifier of candidates) {
    let resolved: string
    try {
      resolved = requireFromSharp.resolve(specifier)
    } catch {
      continue
    }
    let directory = path.dirname(resolved)
    while (dirHasNoPackageJson(directory)) {
      const parent = path.dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    const metadata = path.join(directory, 'package.json')
    if (!fs.existsSync(metadata)) continue
    const parsed: unknown = JSON.parse(fs.readFileSync(metadata, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && 'name' in parsed && parsed.name === name) {
      return directory
    }
  }

  throw new Error(
    `package: cannot resolve ${name} from sharp's runtime dependency tree. ` +
      'Run pnpm install, or update RUNTIME_PACKAGES in scripts/package-layout.ts.',
  )
}

function dirHasNoPackageJson(directory: string): boolean {
  return !fs.existsSync(path.join(directory, 'package.json'))
}

/**
 * Resolve every package sharp loads at run time, `sharp` first, from sharp's own
 * real directory. The returned map is package name → directory to copy.
 */
function runtimePackages(): Map<string, string> {
  const sharpLink = path.join(REPO_ROOT, 'node_modules', 'sharp')
  if (!fs.existsSync(sharpLink)) {
    throw new Error('package: node_modules/sharp is missing; run pnpm install')
  }
  const sharpReal = fs.realpathSync(sharpLink)
  const requireFromSharp = createRequire(path.join(sharpReal, 'package.json'))

  const found = new Map<string, string>()
  for (const name of RUNTIME_PACKAGES) {
    found.set(name, name === 'sharp' ? sharpReal : runtimePackageDir(requireFromSharp, name))
  }
  return found
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
  const builtVersion = packageVersion(path.join(BUILD_DIR, 'package.json'))
  if (builtVersion !== version) {
    throw new Error(
      `package: build/package.json is ${builtVersion} but the release is ${version} — run pnpm build`,
    )
  }
}

/** Plan every entry the release contains, and nothing else. */
function planArchive(version: string): { plan: PlannedFile[]; templateFile: string } {
  assertBuildTree(version)
  const template = readSiteEnv(PACKAGING_DIR)
  const runtime = nodeRuntimeFile({ execPath: process.execPath, env: process.env })

  const plan: PlannedFile[] = []

  // The archive root: whatever packaging\ offers as a .bat or .txt (#87, #89),
  // copied byte for byte. 启动.bat is CRLF and ASCII, and copying is the only
  // operation that keeps it that way.
  for (const name of rootPackageFiles(PACKAGING_DIR)) {
    addFile(plan, name, path.join(PACKAGING_DIR, name))
  }

  // The program: the bundles, the tree's package metadata and the page.
  for (const name of APP_BUILD_FILES) {
    addFile(plan, `app/${name}`, path.join(BUILD_DIR, name))
  }
  collectTree(PAGE_DIST, 'app/web/dist', plan, new Set())

  // The runtime, from the running Node unless #88 names an official one.
  addFile(plan, 'app/node.exe', runtime)

  // sharp and what sharp itself loads. The predicate allows exactly these
  // package names; the directories are resolved, never guessed.
  for (const [name, directory] of runtimePackages()) {
    collectTree(directory, `app/node_modules/${name}`, plan, new Set())
  }

  // The generated configuration, from the committed template's text. This is
  // the single most important line in the ticket: the repository's own `.env` is
  // the owner's, and it is never read here.
  plan.push({
    archivePath: 'app/.env',
    source: { name: 'app/.env', data: Buffer.from(template.text, 'utf8') },
    bytes: Buffer.byteLength(template.text),
  })

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
 *   2. the required entries are present — a package without its launcher, page
 *      or generated configuration is broken even if every path is legal;
 *   3. no entry's *source* is the owner's `.env` or under the data directory,
 *      which is defence in depth behind the path rule;
 *   4. the template that became `app\.env` is the committed one.
 */
function assertArchivePlan(plan: readonly PlannedFile[], templateFile: string): void {
  assertPackagedPaths(plan.map(entry => entry.archivePath))

  const present = new Set(plan.map(entry => entry.archivePath))
  const required = [
    LAUNCHER_FILE,
    'app/server.js',
    'app/run.js',
    'app/package.json',
    'app/node.exe',
    'app/.env',
    'app/web/dist/index.html',
    ...RUNTIME_PACKAGES.map(name => `app/node_modules/${name}/package.json`),
  ]
  const missing = required.filter(archivePath => !present.has(archivePath))
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
        'package: refusing to ship the working tree .env — app/.env comes from packaging/site.env',
      )
    }
    if (isInside(sourceFile, OWNER_DATA_DIR)) {
      throw new Error(`package: refusing to ship a file from the data directory: ${sourceFile}`)
    }
  }

  if (!isInside(path.resolve(templateFile), PACKAGING_DIR)) {
    throw new Error(`package: app/.env was not generated from packaging/site.env (${templateFile})`)
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
