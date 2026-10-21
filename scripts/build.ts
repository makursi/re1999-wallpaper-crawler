#!/usr/bin/env node
// ── The build: the program, not the sources ─────────────────────────
//
// `pnpm build` writes the tree a packaged program is made of (#84):
//
//   build\
//     server.js        the Console, bundled from web/server/console.ts
//     run.js           a Run, bundled from core/main.ts
//     package.json     names the tree ESM and its version
//     web\dist\**      the page, built by Vite (ADR 0011)
//
// Two entries and one page, and that is the whole program: the bundled files are
// what a packaged tree runs, so a missing `node_modules`, `tsx` or `vite` on the
// owner's machine changes nothing. `build\` is also a complete application root —
// `node build\server.js` from a shell in that directory finds `.env`, the page
// and the Run entry where `web/server/build-artifacts.ts` says they are.
//
// **What is external, and why exactly one thing is.** Everything bundles:
// `hono`, `@hono/node-server`, `pino`, `pino-pretty`, `undici`, `zod`, `dotenv`
// and their transitive dependencies, into one file each. `sharp` is external and
// stays a module: it links a platform binary, which no bundler can put inside a
// JS file, and the tree carries it beside the program (#86). That list is not an
// intention — `undeclaredExternals` reads esbuild's own metafile and this script
// fails when the bundle left anything else behind, naming the package and the
// bundle it is in. A package that genuinely cannot be bundled therefore has to be
// argued for in `scripts/bundle-externals.ts`, where the allow-list lives.
//
// The version is one `define`, read from `package.json`: `core/version.ts` turns
// `RE1999_VERSION` into the string a source run reads from the metadata, so a
// bundled status payload reports the release's number and nothing else (#79).
//
// The page is built here rather than on first start (which is what #84 removed):
// a shipped program does not compile its own wheel, and the Console refuses to
// boot without the artifact rather than building one.

import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

import { build as esbuild } from 'esbuild'
import { build as buildPage } from 'vite'

import {
  RUN_ENTRY_FILE,
  SERVER_ENTRY_FILE,
  UPDATE_ENTRY_FILE,
} from '../web/server/build-artifacts.js'
import type { BundleOutputImports } from './bundle-externals.js'
import { ALLOWED_EXTERNALS, bundledPackages, undeclaredExternals } from './bundle-externals.js'
import { packageVersion } from './package-version.js'

/** The repository root: this script's parent, which is also a source app root. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..')

/** The built tree, and the application root a packaged program starts from. */
const BUILD_DIR = path.join(REPO_ROOT, 'build')

/** The page's build, as `web/vite.config.ts` owns it (root, plugins, outDir). */
const VITE_CONFIG = path.join(REPO_ROOT, 'web', 'vite.config.ts')
const PAGE_DIR = path.join(REPO_ROOT, 'web', 'dist')

/** The one file that declares the version (`core/version.ts` reads it). */
const PACKAGE_FILE = path.join(REPO_ROOT, 'package.json')

/** The two files the program is, and the sources they come from. */
interface Entry {
  /** What the entry is, for the build's report. */
  label: string
  /** The source, relative to the repository root. */
  source: string
  /** The output's name, in the built tree's root. */
  output: string
}

const ENTRIES: readonly Entry[] = [
  { label: 'the Console', source: 'web/server/console.ts', output: SERVER_ENTRY_FILE },
  { label: 'a Run', source: 'core/main.ts', output: RUN_ENTRY_FILE },
  // #87: `更新.bat` starts this one. It lives in the built tree for the same
  // reason the other two do — a shipped package runs no transpiler — and it is
  // the one entry whose failure has to roll a folder back, which is why its
  // logic is a tested module rather than lines in the `.bat`.
  { label: 'the updater', source: 'web/server/update-entry.ts', output: UPDATE_ENTRY_FILE },
]

/**
 * The one line an ESM bundle of CommonJS packages cannot do without.
 *
 * esbuild inlines a CommonJS dependency's `require` as its own shim, and in ESM
 * output that shim has no `require` to call: without this banner the first
 * bundled CJS package that requires a builtin (`dotenv` requires `fs`) dies at
 * import with "Dynamic require of \"fs\" is not supported". `createRequire`
 * gives the shim Node's own loader, resolved from the bundle's own URL — the
 * one place `import.meta.url` is genuinely wanted, and it is the *module's*
 * location, never the application root, which stays an injected input (#78).
 */
const CJS_INTEROP_BANNER = [
  "import { createRequire as __re1999CreateRequire } from 'node:module'",
  'const require = __re1999CreateRequire(import.meta.url)',
].join('\n')

/** One entry's bundle, read through esbuild's own report of it. */
interface EntryBundle {
  /** What the bundle still imports from outside itself. */
  externals: BundleOutputImports[]
  /** Every file esbuild read into the bundle, as its metafile named it. */
  inputs: string[]
}

/** One entry, bundled into the built tree. */
async function bundleEntry(entry: Entry, version: string): Promise<EntryBundle> {
  const result = await esbuild({
    // Absolute from the repository root: this script may be started from
    // anywhere, and nothing here may depend on the caller's working directory.
    absWorkingDir: REPO_ROOT,
    entryPoints: [path.join(REPO_ROOT, entry.source)],
    outfile: path.join(BUILD_DIR, entry.output),
    bundle: true,
    platform: 'node',
    format: 'esm',
    // The runtime floor `package.json`'s `engines` names.
    target: 'node22',
    external: [...ALLOWED_EXTERNALS],
    define: { RE1999_VERSION: JSON.stringify(version) },
    banner: { js: CJS_INTEROP_BANNER },
    metafile: true,
    logLevel: 'warning',
  })

  const outputs = Object.entries(result.metafile.outputs)
  return {
    externals: outputs.map(([file, output]) => ({
      file: path.relative(REPO_ROOT, file).replaceAll('\\', '/'),
      imports: output.imports.filter(imported => imported.external).map(imported => imported.path),
    })),
    inputs: Object.keys(result.metafile.inputs),
  }
}

/**
 * `build\package.json`: the tree is ESM, and it says which version it is.
 *
 * Without `"type": "module"` Node would read `server.js` as CommonJS and the
 * program would not start at all. The version is repeated rather than derived so
 * the tree is self-describing — the `define` is what the running program uses,
 * and `core/version.ts` reads this file only as a source run's fallback.
 */
function writeTreePackageJson(version: string): void {
  const treePackage = {
    name: 're1999-wallpaper-crawler',
    version,
    private: true,
    type: 'module',
  }
  fs.writeFileSync(
    path.join(BUILD_DIR, 'package.json'),
    `${JSON.stringify(treePackage, null, 2)}\n`,
    'utf8',
  )
}

/** The page Vite writes, copied into the built tree as the app root expects it. */
async function buildThePage(): Promise<void> {
  await buildPage({ configFile: VITE_CONFIG })
  fs.cpSync(PAGE_DIR, path.join(BUILD_DIR, 'web', 'dist'), { recursive: true })
}

/** The built files, with their sizes, as the report prints them. */
function sizeOf(file: string): string {
  return `${(fs.statSync(file).size / 1024).toFixed(0)} KiB`
}

/** The build, in the order the tree needs: clean, page, entries, check, report. */
async function main(): Promise<void> {
  const version = packageVersion(PACKAGE_FILE)

  fs.rmSync(BUILD_DIR, { recursive: true, force: true })
  fs.mkdirSync(BUILD_DIR, { recursive: true })

  await buildThePage()
  const bundles = await Promise.all(ENTRIES.map(entry => bundleEntry(entry, version)))
  writeTreePackageJson(version)

  const undeclared = undeclaredExternals(bundles.flatMap(bundle => bundle.externals))
  if (undeclared.length > 0) {
    // An exit code, not a warning: a bundle that leaves an import for
    // `node_modules` cannot run in the tree this build exists to produce.
    for (const { file, specifier } of undeclared) {
      process.stderr.write(
        `build: ${file} still imports "${specifier}" from node_modules — ` +
          'bundle it, or declare it in scripts/bundle-externals.ts with the reason\n',
      )
    }
    process.exit(1)
  }

  const pageFiles = fs
    .readdirSync(path.join(BUILD_DIR, 'web', 'dist'), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).length
  process.stdout.write(`build: version ${version}\n`)
  process.stdout.write(`build: the page — ${pageFiles} files in build/web/dist\n`)
  for (const entry of ENTRIES) {
    const file = path.join(BUILD_DIR, entry.output)
    process.stdout.write(`build: ${entry.label} — build/${entry.output} (${sizeOf(file)})\n`)
  }
  process.stdout.write(`build: external — ${ALLOWED_EXTERNALS.join(', ')} (native addon)\n`)
  process.stdout.write(
    `build: bundled — ${bundledPackages(bundles.flatMap(bundle => bundle.inputs)).join(', ')}\n`,
  )
}

main().catch(error => {
  process.stderr.write(`build: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
