// ── What may enter the portable archive (#86) ───────────────────────
//
// The release's promise is "the archive physically cannot carry the owner's
// data". A promise like that is not kept by remembering to look: the contents
// are a whitelist, and `scripts/package.ts` asserts the collected list against
// it before a single byte of zip is written. This module is that whitelist plus
// the other three decisions the packager must not make twice:
//
//   - **The archive root comes from `packaging\` generically.** Every regular
//     `.bat` and `.txt` directly in that directory is a root file, so #87
//     (`更新.bat`) and #89 (`使用说明.txt`) add a file and no packager code.
//     `packaging\site.env` is the one file there that is *not* a root file: it is
//     the committed template the generated `app\.env` comes from.
//   - **The generated `.env` comes from that template, never from the working
//     tree.** The repository's own `.env` is the owner's local file and is
//     gitignored; the only configuration a release can carry is the one written
//     here from `packaging\site.env` (#75, "制品形状").
//   - **`node.exe` comes from the running Node for a local package.** #88 will
//     supply an official runtime in CI; `RE1999_NODE_EXE` is the way in, and a
//     missing runtime is a loud failure rather than a package that cannot start.
//
// The predicate works on **archive-relative paths** (`app/server.js`,
// `启动.bat`). That is the list the packager actually collects, so asserting it
// is asserting the archive's real contents — not a second opinion about the
// source tree. A path with `\`, `..`, a drive letter or an empty segment is not
// an archive path at all, and is refused before any rule gets to allow it.
//
// `sharp` is the build's only external (`scripts/bundle-externals.ts`), but it is
// not self-contained: its own package metadata names the runtime packages its
// `dist` loads, and a tree that ships only `sharp` boots and then answers every
// thumbnail with a 500. They are listed here explicitly — `RUNTIME_PACKAGES` —
// and the real proof is a `require('sharp')` from an extracted package.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { parse as parseDotenv } from 'dotenv'

import type { ConfigValues } from '../core/config-read.js'
import { readConfig } from '../core/config-read.js'

/** The name of the committed site-constants template, inside `packaging/`. */
export const SITE_ENV_FILE_NAME = 'site.env'

/**
 * The extensions a file directly in `packaging/` may have to become an archive
 * root file. The seam for #87 and #89: add the file, no code changes.
 */
export const ROOT_FILE_EXTENSIONS: readonly string[] = ['.bat', '.txt']

/** The files `scripts/build.ts` writes that go straight into `app\`. */
export const APP_BUILD_FILES: readonly string[] = [
  'server.js',
  'run.js',
  'update.js',
  'package.json',
]

/**
 * The packages that travel beside the program in `app\node_modules\`, as
 * archive-relative package names.
 *
 * `sharp` is the external the build allows. The other four are what sharp's own
 * `dist` requires at run time — `@img/colour` and `@img/sharp-win32-x64` are its
 * native and colour halves, `detect-libc` and `semver` are loaded by its native
 * loader — and each is resolved from sharp's own dependency tree when the tree
 * is collected. `@img` is the scope directory, so its two packages are named
 * whole.
 */
export const RUNTIME_PACKAGES: readonly string[] = [
  'sharp',
  '@img/colour',
  '@img/sharp-win32-x64',
  'detect-libc',
  'semver',
]

/** The exact files that live directly in `app\`. */
const APP_ROOT_FILES: readonly string[] = [...APP_BUILD_FILES, 'node.exe', '.env']

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

/** Whether a package directory under `app\node_modules\` is one of the runtime's. */
function isRuntimePackagePath(segments: readonly string[]): boolean {
  return RUNTIME_PACKAGES.some(runtimePackage => {
    const parts = runtimePackage.split('/')
    if (segments.length < 2 + parts.length + 1) return false
    if (segments[0] !== 'app' || segments[1] !== 'node_modules') return false
    return parts.every((part, index) => segments[2 + index] === part)
  })
}

/**
 * Whether one archive-relative path may enter the release.
 *
 * Everything this returns `false` for is deliberate. The obvious refusals are
 * the ones a leak would use: `data\` and the pre-#80 `images\` / `logs\`, the
 * owner's root `.env`, `.git`, `node_modules` at the root (dev dependencies),
 * `build\` and `web\dist\` (gitignored build leftovers, and neither is the
 * shape a package holds), and every source, test, script and tooling config.
 * The `app\` side is just as strict: only the built entries, the page under
 * `app\web\dist\`, the runtime, the generated `.env`, and sharp's closure.
 */
export function isPackagedPath(archivePath: string): boolean {
  const segments = archivePathSegments(archivePath)
  if (segments === null) return false

  // The archive root: the launcher and the documents beside it, and nothing
  // else. Hidden dotfiles are not documents a person is meant to see.
  if (segments.length === 1) {
    const [name] = segments
    if (name.startsWith('.')) return false
    return ROOT_FILE_EXTENSIONS.some(extension => name.toLowerCase().endsWith(extension))
  }

  if (segments[0] !== 'app') return false
  if (segments.length === 2) return APP_ROOT_FILES.includes(segments[1])

  // app\web\dist\**: the page and its assets, and nothing from web\src\ or
  // web\server\.
  if (segments[1] === 'web' && segments[2] === 'dist' && segments.length >= 4) return true

  return isRuntimePackagePath(segments)
}

/** Every collected path the whitelist refuses, in the order they were collected. */
export function packagePathOffenders(archivePaths: readonly string[]): string[] {
  return archivePaths.filter(archivePath => !isPackagedPath(archivePath))
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

/**
 * The archive root's files, read from `packaging\` generically (#87, #89).
 *
 * Regular files directly in the directory, with a root-file extension, not
 * hidden. The order is sorted so two builds list the archive the same way.
 */
export function rootPackageFiles(packagingDir: string): string[] {
  return fs
    .readdirSync(packagingDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => !name.startsWith('.'))
    .filter(name => ROOT_FILE_EXTENSIONS.some(extension => name.toLowerCase().endsWith(extension)))
    .toSorted()
}

/** The committed site-constants template, as read and as validated. */
export interface SiteEnvTemplate {
  /** The template file it was read from. */
  file: string
  /** Its text, which becomes `app\.env` byte for byte. */
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
        'a release generates app/.env from this committed file, never from the working tree ' +
        `(${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    )
  }

  const values = readConfig(parseDotenv(text))
  if (values === null) {
    throw new Error(
      `package: ${SITE_ENV_FILE_NAME} is not a configuration the schema accepts; ` +
        'it must name at least BASE_ORIGIN (core/config-read.ts). ' +
        'The packaged app/.env is generated from this template and never copied from the working tree.',
    )
  }

  return { file, text, values, baseOrigin: values.BASE_ORIGIN }
}

/** The environment variable that names an official Node runtime (#88's seam). */
export const NODE_RUNTIME_ENV = 'RE1999_NODE_EXE'

export interface NodeRuntimeOptions {
  /** The running Node's own executable: `process.execPath`. */
  execPath: string
  /** The environment; `RE1999_NODE_EXE` wins when it names one. */
  env?: NodeJS.ProcessEnv
  /** Injected so the failure can be tested without deleting a runtime. */
  exists?: (file: string) => boolean
}

/**
 * The `node.exe` a package ships, or a failure that says how to supply one.
 *
 * For a local package it is the running Node (`process.execPath`), which is the
 * runtime the build was just proven on. #88's CI job supplies the official
 * runtime through `RE1999_NODE_EXE`; downloading one is that ticket's, not this
 * packager's.
 */
export function nodeRuntimeFile(options: NodeRuntimeOptions): string {
  const supplied = options.env?.[NODE_RUNTIME_ENV]?.trim()
  const file = supplied !== undefined && supplied.length > 0 ? supplied : options.execPath
  const exists = options.exists ?? fs.existsSync
  if (!exists(file)) {
    throw new Error(
      `package: no Node runtime to ship — ${file} is not there. ` +
        'Run the packager with the Node you mean to ship, or set ' +
        `${NODE_RUNTIME_ENV} to an official runtime (#88).`,
    )
  }
  return path.resolve(file)
}
