// ── The manifest a program directory carries (#117) ────────────────
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
// The two are read from the real `package.json`, never copied into this file: a
// bump must not leave a second floor or a stale sharp spec behind.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { isRecord } from '../../scripts/json.js'
import { shippedDependenciesOf, shippedManifestOf } from '../../scripts/package-manifest.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

/** The repository manifest, as `scripts/build.ts` parses it. */
const REPOSITORY = repositoryManifest()

function repositoryManifest(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  if (!isRecord(parsed)) throw new Error('the repository package.json is not a JSON object')
  return parsed
}

/** One nested object field, or a failure naming it. */
function objectField(manifest: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = manifest[name]
  if (!isRecord(value)) throw new Error(`the repository package.json has no ${name} object`)
  return value
}

/** One nested string field, trimmed, or a failure naming it. */
function stringField(manifest: Record<string, unknown>, parent: string, name: string): string {
  const value = objectField(manifest, parent)[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`the repository package.json has no ${parent}.${name}`)
  }
  return value.trim()
}

/** The two single sources these tests pin, read from the real manifest. */
const FLOOR = stringField(REPOSITORY, 'engines', 'node')
const SHARP = stringField(REPOSITORY, 'dependencies', 'sharp')

describe('shippedManifestOf', () => {
  it('writes the complete manifest the program directory needs', () => {
    expect(shippedManifestOf(REPOSITORY, '2.0.0')).toEqual({
      name: REPOSITORY.name,
      version: '2.0.0',
      private: true,
      type: 'module',
      engines: { node: FLOOR },
      scripts: { start: 'node server.js' },
      dependencies: { sharp: SHARP },
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
      { ...REPOSITORY, engines: { node: `  ${FLOOR}  ` } },
      '  2.0.0  ',
    )

    expect(manifest.engines.node).toBe(FLOOR)
    expect(manifest.version).toBe('2.0.0')
    expect(manifest.dependencies.sharp).toBe(SHARP)
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

describe('shippedDependenciesOf', () => {
  it('reads the dependency map a written manifest declares', () => {
    // The packager compares the generated lockfile against this map; reading it
    // here is what keeps the manifest's shape in one module.
    expect(shippedDependenciesOf({ dependencies: { sharp: SHARP } })).toEqual({ sharp: SHARP })
  })

  it('answers null for a value that is not a manifest with a dependency map', () => {
    expect(shippedDependenciesOf({})).toBeNull()
    expect(shippedDependenciesOf('not a manifest')).toBeNull()
    expect(shippedDependenciesOf({ dependencies: [] })).toBeNull()
  })

  it('refuses a dependency whose spec is not a usable string', () => {
    expect(() => shippedDependenciesOf({ dependencies: { sharp: ' ' } })).toThrow(/sharp/)
    expect(() => shippedDependenciesOf({ dependencies: { sharp: 1 } })).toThrow(/sharp/)
  })
})
