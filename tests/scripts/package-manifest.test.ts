// ── The manifest a shipped root carries (#117) ──────────────────────
//
// `build/` is the install root of a flat, npm-delivered release: copied out of
// the repository, `npm install` once and `npm start` boots it (spec #116). What
// makes that work is `build/package.json`, and this module is the one place its
// shape is decided: the name and version, the ESM marker, the engine floor, the
// zero-argument start script, and `sharp` as the only runtime dependency —
// everything else is already inside the bundles.
//
// These pin the shape and the two single sources (`engines.node` and
// `dependencies.sharp` of the repository manifest) so a field added or dropped
// here is a test change, not a release that installs something it cannot run.

import { describe, expect, it } from 'vitest'

import { shippedManifestOf } from '../../scripts/package-manifest.js'

/** The repository manifest, as `scripts/build.ts` parses it. */
const REPOSITORY = {
  name: 're1999-wallpaper-crawler',
  engines: { node: '>=22.22.1' },
  dependencies: {
    hono: '4.13.13',
    pino: '^10.3.1',
    sharp: '^0.35.5',
    zod: '^4.4.3',
  },
}

describe('shippedManifestOf', () => {
  it('writes the complete manifest the shipped root needs', () => {
    expect(shippedManifestOf(REPOSITORY, '2.0.0')).toEqual({
      name: 're1999-wallpaper-crawler',
      version: '2.0.0',
      private: true,
      type: 'module',
      engines: { node: '>=22.22.1' },
      scripts: { start: 'node server.js' },
      dependencies: { sharp: '^0.35.5' },
    })
  })

  it('keeps sharp as the only runtime dependency', () => {
    // Every other package is inside the bundles; a second dependency here would
    // make the user's `npm install` download something the program never loads.
    expect(Object.keys(shippedManifestOf(REPOSITORY, '2.0.0').dependencies)).toEqual(['sharp'])
  })

  it('starts with the manifest’s own zero-argument script', () => {
    // The arguments enter through `npm start -- …`; the script itself has none.
    expect(shippedManifestOf(REPOSITORY, '2.0.0').scripts).toEqual({ start: 'node server.js' })
  })

  it('copies the floor and sharp’s spec from the repository manifest, trimmed', () => {
    const manifest = shippedManifestOf(
      { ...REPOSITORY, engines: { node: '  >=22.22.1  ' } },
      '  2.0.0  ',
    )

    expect(manifest.engines.node).toBe('>=22.22.1')
    expect(manifest.version).toBe('2.0.0')
    expect(manifest.dependencies.sharp).toBe('^0.35.5')
  })

  it('refuses a repository manifest that cannot source the floor', () => {
    expect(() => shippedManifestOf({ ...REPOSITORY, engines: undefined }, '2.0.0')).toThrow(
      /engines\.node/,
    )
    expect(() => shippedManifestOf({ ...REPOSITORY, engines: {} }, '2.0.0')).toThrow(
      /engines\.node/,
    )
    expect(() => shippedManifestOf({ ...REPOSITORY, engines: { node: ' ' } }, '2.0.0')).toThrow(
      /engines\.node/,
    )
  })

  it('refuses a repository manifest that cannot source sharp', () => {
    expect(() =>
      shippedManifestOf({ ...REPOSITORY, dependencies: { hono: '4.13.13' } }, '2.0.0'),
    ).toThrow(/dependencies\.sharp/)
  })

  it('refuses a manifest that is not an object, and a blank version', () => {
    expect(() => shippedManifestOf('not a manifest', '2.0.0')).toThrow(/JSON object/)
    expect(() => shippedManifestOf(REPOSITORY, '  ')).toThrow(/version/)
  })
})
