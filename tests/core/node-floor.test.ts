// ── The Node floor (#117) ───────────────────────────────────────────
//
// The engine floor has one source: the repository manifest's `engines.node`,
// which the build injects into the bundles the way it injects the version
// (`RE1999_NODE_FLOOR`; `core/version.ts` is the precedent). The Console checks
// it first, before the instance handshake and before it binds a port, so a Node
// too old for the program is one Chinese sentence and exit 1 rather than a page
// that opens and then fails every thumbnail.
//
// Only `>=X.Y.Z` is supported, because that is the one form this repository
// declares; the last test is the guard that keeps it so.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  BUILD_NODE_FLOOR,
  currentNodeFloorRefusal,
  nodeFloorRefusal,
} from '../../core/node-floor.js'

/** The repository root: the file that declares the floor in a source run. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

/** The floor this repository declares in its own manifest. */
function repoFloor(): string {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  if (typeof parsed === 'object' && parsed !== null && 'engines' in parsed) {
    const { engines } = parsed
    if (typeof engines === 'object' && engines !== null && 'node' in engines) {
      const { node } = engines
      if (typeof node === 'string') return node.trim()
    }
  }
  throw new Error('the repository package.json declares no engines.node')
}

/** The floor the tests compare against: the syntax the module supports. */
const FLOOR = '>=22.22.1'

describe('nodeFloorRefusal', () => {
  it('says nothing when the running Node meets or beats the floor', () => {
    expect(nodeFloorRefusal('22.22.1', FLOOR)).toBeNull()
    expect(nodeFloorRefusal('22.22.2', FLOOR)).toBeNull()
    expect(nodeFloorRefusal('24.18.0', FLOOR)).toBeNull()
  })

  it('reads the running version the way Node reports it, with a v', () => {
    expect(nodeFloorRefusal('v24.18.0', FLOOR)).toBeNull()
  })

  it('refuses below the floor, in Chinese, naming both versions', () => {
    const sentence = nodeFloorRefusal('22.22.0', FLOOR)

    expect(sentence).not.toBeNull()
    expect(sentence).toContain('22.22.0')
    expect(sentence).toContain(FLOOR)
    expect(sentence).toMatch(/[\u4e00-\u9fff]/u)
  })

  it('compares each of the three numbers rather than the strings', () => {
    expect(nodeFloorRefusal('9.0.0', FLOOR)).not.toBeNull()
    expect(nodeFloorRefusal('22.21.99', FLOOR)).not.toBeNull()
    // As strings, "22.22.0" > "22.22.1"; as numbers it is below the floor.
    expect(nodeFloorRefusal('22.22.0', FLOOR)).not.toBeNull()
  })

  it('ignores a prerelease suffix on the running version', () => {
    expect(nodeFloorRefusal('v22.22.1-rc.1', FLOOR)).toBeNull()
  })

  it('has no floor to enforce in a source run, or when the floor is blank', () => {
    expect(nodeFloorRefusal('18.0.0', undefined)).toBeNull()
    expect(nodeFloorRefusal('18.0.0', '   ')).toBeNull()
  })

  it('treats a floor in any other syntax as no floor: >=X.Y.Z is the contract', () => {
    expect(nodeFloorRefusal('18.0.0', '22.22.1')).toBeNull()
    expect(nodeFloorRefusal('18.0.0', '>=22')).toBeNull()
    expect(nodeFloorRefusal('18.0.0', '^22.22.1')).toBeNull()
  })

  it('answers for this boot’s running Node when no version is given', () => {
    expect(currentNodeFloorRefusal('20.11.0')).toBe(nodeFloorRefusal('20.11.0', BUILD_NODE_FLOOR))
  })

  it('has nothing injected in a source run', () => {
    // The bundled tree replaces the module's constant; vitest never defines it,
    // which is exactly the "no check" a source run is supposed to have.
    expect(BUILD_NODE_FLOOR).toBeUndefined()
  })

  it('declares a floor the build can enforce: the repository uses >=X.Y.Z only', () => {
    expect(repoFloor()).toMatch(/^>=\d+\.\d+\.\d+$/)
  })
})
