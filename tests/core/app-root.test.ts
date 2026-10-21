import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { APP_ROOT_ENV, dataRootOf, resolveAppRoot } from '../../core/app-root.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function temporaryRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

describe('resolveAppRoot', () => {
  it('takes the application root from the environment', () => {
    const appRoot = path.join(temporaryRoot('app-root-'), 'app')

    expect(resolveAppRoot({ [APP_ROOT_ENV]: appRoot })).toBe(path.resolve(appRoot))
  })

  it('resolves a relative environment value to an absolute root', () => {
    const relative = path.join('some', 'install', 'app')

    expect(resolveAppRoot({ [APP_ROOT_ENV]: relative })).toBe(path.resolve(relative))
  })

  it('ignores the caller’s fallback when the environment names a root', () => {
    // The point of #78: a packaged layout points at itself, and nothing else —
    // not the launch cwd, not the module's own directory — gets a vote.
    const fromEnv = temporaryRoot('app-root-env-')
    const decoy = temporaryRoot('app-root-decoy-')

    expect(resolveAppRoot({ [APP_ROOT_ENV]: fromEnv }, decoy)).toBe(fromEnv)
  })

  it('falls back to the caller’s explicit default when the environment is silent', () => {
    const fallback = path.join(temporaryRoot('app-root-fallback-'), 'app')

    expect(resolveAppRoot({}, fallback)).toBe(path.resolve(fallback))
  })

  it.each(['', '   '])('treats an empty environment value (%j) as silent', value => {
    const fallback = path.join(temporaryRoot('app-root-empty-'), 'app')

    expect(resolveAppRoot({ [APP_ROOT_ENV]: value }, fallback)).toBe(path.resolve(fallback))
  })
})

describe('dataRootOf', () => {
  it('places the data directory beside the application directory', () => {
    // The package's shape: <install>/app and <install>/data are siblings.
    const install = temporaryRoot('data-root-')
    const appRoot = path.join(install, 'app')

    expect(dataRootOf(appRoot)).toBe(path.join(install, 'data'))
  })
})
