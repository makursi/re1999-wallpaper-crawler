// ── The one current version ─────────────────────────────────────────
//
// The number a reader reports in a chat group has to be this build's own, so
// there is one module that resolves it and one file that declares it (#79).
// These pin the resolution order — a value the bundle injects at build time
// first, the application root's package metadata otherwise — and the last test
// states the rule from the other side: whatever the module answers for this
// repository is what `package.json` says, so a second hand-written number
// anywhere would be a disagreement rather than a second opinion.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { applicationVersion, BUILD_VERSION, resolveVersion } from '../../core/version.js'

/** The repository root: the app root a source run resolves (this file's grandparent). */
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** A throwaway application root, with its `package.json` written as data. */
function rootWith(metadata: string | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'version-test-'))
  roots.push(root)
  if (metadata !== null) fs.writeFileSync(path.join(root, 'package.json'), metadata)
  return root
}

/** A `package.json` naming one version. */
function packageWith(version: unknown): string {
  return JSON.stringify({ name: 'version-test', version })
}

/** The `version` field of the repository's own package metadata. */
function repoVersion(): string {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
    const { version } = parsed
    if (typeof version === 'string') return version
  }
  throw new Error('the repository package.json carries no version')
}

describe('the application version', () => {
  it('reports the version a build injected, ahead of any package metadata', () => {
    expect(resolveVersion('9.8.7', rootWith(packageWith('1.2.3')))).toBe('9.8.7')
  })

  it('falls back to the package metadata at the application root, not a module path', () => {
    const appRoot = rootWith(packageWith('7.4.2'))

    expect(resolveVersion(undefined, appRoot)).toBe('7.4.2')
  })

  it('treats a blank injected value as absent', () => {
    expect(resolveVersion('   ', rootWith(packageWith('7.4.2')))).toBe('7.4.2')
  })

  it('reports no version when the metadata is absent, malformed or versionless', () => {
    expect(resolveVersion(undefined, rootWith(null))).toBeNull()
    expect(resolveVersion(undefined, rootWith('{ not json'))).toBeNull()
    expect(resolveVersion(undefined, rootWith('[]'))).toBeNull()
    expect(resolveVersion(undefined, rootWith(packageWith(42)))).toBeNull()
    expect(resolveVersion(undefined, rootWith('{}'))).toBeNull()
  })

  it('has nothing injected in a source run', () => {
    // The packaged bundle (#84) replaces the module's constant; a source run
    // never does, and the metadata below it is the fallback.
    expect(BUILD_VERSION).toBeUndefined()
  })

  it('answers with the version this repository’s package.json declares', () => {
    // The guard against a second hand-written number: the module's answer for
    // the real root and the metadata file cannot drift apart.
    const version = applicationVersion(REPO_ROOT)

    expect(version).toBe(repoVersion())
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:[-+].*)?$/)
  })
})
