// ── The shipped tree's artifacts (#84) ──────────────────────────────
//
// A bundled program is two entry files and a page, and every one of them is a
// build artifact: the Console compiles nothing at boot, so an absent page or an
// absent Run entry is a broken build or a broken package, and the one thing it
// must not do is look fine until someone clicks.

import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildArtifactRefusal,
  pageEntryFile,
  runEntryPath,
  RUN_ENTRY_FILE,
} from '../../../web/server/build-artifacts.js'

const APP_ROOT = path.join('C:\\', 'install', 'app')
const DIST_DIR = path.join(APP_ROOT, 'web', 'dist')

/** A filesystem that has exactly the named files. */
function only(...files: string[]): (file: string) => boolean {
  const present = new Set(files.map(file => path.resolve(file)))
  return file => present.has(path.resolve(file))
}

const COMPLETE = only(runEntryPath(APP_ROOT), pageEntryFile(DIST_DIR))

describe('runEntryPath', () => {
  it('names the Run entry beside the Console entry, inside the app root', () => {
    // The packaged tree: `app\server.js` and `app\run.js` are siblings, and the
    // root is an input — never this module's own depth, which the bundle
    // collapses (#78, #84).
    expect(runEntryPath(APP_ROOT)).toBe(path.join(APP_ROOT, RUN_ENTRY_FILE))
  })

  it('names no node_modules path: a packaged tree carries no tsx to load the Run', () => {
    expect(runEntryPath(APP_ROOT)).not.toContain('node_modules')
    expect(RUN_ENTRY_FILE).toBe('run.js')
  })
})

describe('pageEntryFile', () => {
  it('names the built page document inside the injected page directory', () => {
    expect(pageEntryFile(DIST_DIR)).toBe(path.join(DIST_DIR, 'index.html'))
  })
})

describe('buildArtifactRefusal', () => {
  it('says nothing when the tree carries both artifacts', () => {
    expect(
      buildArtifactRefusal({ appRoot: APP_ROOT, distDir: DIST_DIR, exists: COMPLETE }),
    ).toBeNull()
  })

  it('refuses a tree with no page, and names the file and the build command', () => {
    const refusal = buildArtifactRefusal({
      appRoot: APP_ROOT,
      distDir: DIST_DIR,
      exists: only(runEntryPath(APP_ROOT)),
    })

    expect(refusal).toMatchObject({ code: 'missing-artifact' })
    expect(refusal?.missing).toEqual([pageEntryFile(DIST_DIR)])
    // The page is not compiled on the owner's first click any more: the message
    // has to point at the build that produces it.
    expect(refusal?.message).toContain(pageEntryFile(DIST_DIR))
    expect(refusal?.message).toContain('pnpm build')
  })

  it('refuses a tree with no Run entry, and names the file', () => {
    const refusal = buildArtifactRefusal({
      appRoot: APP_ROOT,
      distDir: DIST_DIR,
      exists: only(pageEntryFile(DIST_DIR)),
    })

    expect(refusal?.missing).toEqual([runEntryPath(APP_ROOT)])
    expect(refusal?.message).toContain(runEntryPath(APP_ROOT))
  })

  it('names every absent artifact rather than the first one found', () => {
    const refusal = buildArtifactRefusal({
      appRoot: APP_ROOT,
      distDir: DIST_DIR,
      exists: () => false,
    })

    expect(refusal?.missing).toEqual([runEntryPath(APP_ROOT), pageEntryFile(DIST_DIR)])
    expect(refusal?.message).toContain(runEntryPath(APP_ROOT))
    expect(refusal?.message).toContain(pageEntryFile(DIST_DIR))
  })
})
