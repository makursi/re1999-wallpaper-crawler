// ── What a bundle may still import at run time (#84) ────────────────
//
// The build's promise is "everything is inside the file except the one native
// addon, sharp". That promise is only worth what checks it: esbuild reports every
// import it left unresolved in its metafile, and the build refuses to finish when
// that list holds anything the tree did not knowingly ship. These are the two
// pure readings of that report.

import { describe, expect, it } from 'vitest'

import {
  ALLOWED_EXTERNALS,
  bundledPackages,
  undeclaredExternals,
} from '../../scripts/bundle-externals.js'

describe('undeclaredExternals', () => {
  it('says nothing when the only imports left are the allow-list and Node itself', () => {
    const found = undeclaredExternals([
      // A bundled CommonJS dependency reaches a builtin as a bare `fs`; this
      // repository's own sources write `node:fs`. Both are the runtime's.
      { file: 'build/server.js', imports: ['sharp', 'node:fs', 'fs', 'path'] },
      { file: 'build/run.js', imports: ['node:process', 'worker_threads'] },
    ])

    expect(found).toEqual([])
  })

  it('names an import that the bundle quietly left to node_modules, and which file it is in', () => {
    // The failure this exists for: `web/server/console.ts` imported Vite at boot
    // (#84), so a bundle that type-checked would look for node_modules on a
    // machine that has none.
    const found = undeclaredExternals([{ file: 'build/server.js', imports: ['vite', 'sharp'] }])

    expect(found).toEqual([{ file: 'build/server.js', specifier: 'vite' }])
  })

  it('reports each undeclared import once, however many sites share it', () => {
    const found = undeclaredExternals([
      { file: 'build/server.js', imports: ['lightningcss', 'lightningcss'] },
      { file: 'build/run.js', imports: ['lightningcss'] },
    ])

    expect(found).toEqual([
      { file: 'build/server.js', specifier: 'lightningcss' },
      { file: 'build/run.js', specifier: 'lightningcss' },
    ])
  })

  it('leaves node: builtins alone: the runtime is the program', () => {
    expect(
      undeclaredExternals([{ file: 'build/run.js', imports: ['node:sqlite', 'node:test'] }]),
    ).toEqual([])
  })

  it('keeps the allow-list to the native addon', () => {
    // One native dependency, named here so a second one has to be argued for.
    expect(ALLOWED_EXTERNALS).toEqual(['sharp'])
  })
})

describe('bundledPackages', () => {
  it('reads the package name out of a pnpm-store path', () => {
    // esbuild's metafile names the real files, and pnpm's are one `node_modules`
    // deep inside another.
    expect(
      bundledPackages([
        'node_modules/.pnpm/hono@4.13.13/node_modules/hono/dist/index.js',
        'node_modules/.pnpm/pino@10.3.1/node_modules/pino/pino.js',
      ]),
    ).toEqual(['hono', 'pino'])
  })

  it('keeps a scoped name whole', () => {
    expect(
      bundledPackages([
        'node_modules/.pnpm/@hono+node-server@2.1.5/node_modules/@hono/node-server/dist/index.mjs',
      ]),
    ).toEqual(['@hono/node-server'])
  })

  it('ignores files that are not in node_modules, and sorts what it found', () => {
    expect(
      bundledPackages([
        'core/main.ts',
        'web/server/console.ts',
        'node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js',
      ]),
    ).toEqual(['zod'])
  })
})
