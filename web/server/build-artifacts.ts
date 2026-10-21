// ── The shipped tree's artifacts ────────────────────────────────────
//
// A built program is three files' worth of program — the Console entry, the Run
// entry, and the page — and they are all build artifacts (#84). The Console
// compiles nothing at boot: `pnpm build` (`scripts/build.ts`) writes them and
// whatever ships them (the portable package, #86) carries them as they are.
//
// Two consequences follow, and this module is both:
//
//   1. **The Run entry is a sibling of the Console entry, inside the app root.**
//      The Console starts a Run by handing `process.execPath` one argument, and
//      that argument is `runEntryPath(appRoot)`. There is no transpiler in a
//      packaged tree and no `node_modules` to find one in, so this must never
//      name one. The root is the injected input (#78); the entries' depth is
//      what bundling collapses.
//   2. **A missing artifact is a broken build or a broken package**, and the
//      start says so once, in Chinese, before it binds a port. The alternative —
//      building the page on the owner's first click — is what #84 removed: a
//      shipped program does not compile its own wheel, and the failure then
//      arrives as a blank page (or a Run that dies with an ENOENT nobody sees)
//      long after the mistake was made.
//
// The refusal is a `BuildArtifactRefusal`, the shape `core/data-layout.ts` uses
// for its own start refusal: a stable code, the paths it is about, and the
// sentence a person reads.

import * as fs from 'node:fs'
import * as path from 'node:path'

/** The Console's entry in the built tree. Written by `scripts/build.ts`. */
export const SERVER_ENTRY_FILE = 'server.js'

/**
 * A Run's entry in the built tree: the one argument the Console hands
 * `process.execPath` when a Run is started (#84). `pnpm core:run` runs the same
 * source through tsx, but that is a repository command, not a shipped one.
 */
export const RUN_ENTRY_FILE = 'run.js'

/** The page's entry document, inside the page directory Vite writes. */
export const PAGE_ENTRY_FILE = 'index.html'

/**
 * `<appRoot>/run.js` — the Run's argv slot 1.
 *
 * The root is the caller's input, never this module's own position: a bundled
 * module has no meaningful depth, and a packaged `app\` sits wherever the owner
 * unzipped it (#78, #84).
 */
export function runEntryPath(appRoot: string): string {
  return path.join(appRoot, RUN_ENTRY_FILE)
}

/** `<distDir>/index.html` — the one file that proves the page was built. */
export function pageEntryFile(distDir: string): string {
  return path.join(distDir, PAGE_ENTRY_FILE)
}

/** A file-existence test, injected so a refusal can be checked without a build. */
export type FileExists = (file: string) => boolean

export interface BuildArtifactDeps {
  /** The application root, resolved by the entry point (#78). */
  appRoot: string
  /** The page's directory; `web/dist` under the app root (ADR 0011). */
  distDir: string
  /** Injected so a test can present a complete (or broken) tree. */
  exists?: FileExists
}

/** Why a built tree cannot start: the artifacts that are not there. */
export interface BuildArtifactRefusal {
  code: 'missing-artifact'
  /** The absent files, absolute, in the order the tree lists them. */
  missing: string[]
  /** The Chinese explanation the person who built or packaged it reads. */
  message: string
}

/**
 * The artifacts this tree is missing, or `null` when it has them all.
 *
 * Every check runs, so a tree missing both says both rather than naming the
 * first thing found. The two are one fault — the build did not run, or a
 * package was assembled from a partial tree — so they are one refusal.
 */
export function buildArtifactRefusal(deps: BuildArtifactDeps): BuildArtifactRefusal | null {
  const exists = deps.exists ?? fs.existsSync
  const required = [runEntryPath(deps.appRoot), pageEntryFile(deps.distDir)]
  const missing = required.filter(file => !exists(file))
  if (missing.length === 0) return null

  return {
    code: 'missing-artifact',
    missing,
    message: [
      '构建产物缺失:',
      ...missing.map(file => `  ${file}`),
      '页面与 Run 入口都是构建产物,启动时不编译。请先运行 pnpm build,或改用完整解压的发布包。',
    ].join('\n'),
  }
}
