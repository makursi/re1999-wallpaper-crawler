import * as os from 'node:os'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ConfigValues } from '../../../core/config-read.js'
import { parseConfig, siteConfig } from '../../../core/config-read.js'
import { consoleConfigOf } from '../../../web/server/console-config.js'

/** The one key a Run's configuration must supply. */
const VALUES = parseConfig({
  BASE_ORIGIN: 'https://re.bluepoch.com',
})

/** The app root a packaged layout would hand the entry point. */
const APP_ROOT = path.join(os.tmpdir(), 'console-config-install', 'app')
/** The user's data directory, the app root's sibling (`<install>/data`). */
const DATA_ROOT = path.join(os.tmpdir(), 'console-config-install', 'data')

/** The web layer's root as a module-relative derivation would find it. */
const MODULE_WEB_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', 'web')

function configFor(values: ConfigValues | null = VALUES, dataRoot = DATA_ROOT) {
  return consoleConfigOf(APP_ROOT, values, siteConfig(APP_ROOT, values, dataRoot))
}

describe('consoleConfigOf', () => {
  it('takes the built page and the app root from the injected value, not module location', () => {
    const config = configFor()

    expect(config.appRoot).toBe(APP_ROOT)
    expect(config.distDir).toBe(path.join(APP_ROOT, 'web', 'dist'))
    // The old derivation: `web/server/console.ts` → `web/` → `web/dist`. If this
    // implementation ever falls back to it, a packaged layout serves nothing.
    expect(config.distDir).not.toBe(path.join(MODULE_WEB_ROOT, 'dist'))
  })

  it('derives the Gallery list endpoint from the layered configuration', () => {
    expect(configFor().galleryListEndpoint).toBe(
      'https://re.bluepoch.com/activity/official/websites/picture/query',
    )
  })

  it('carries the user’s data paths from the data root, never from the app root', () => {
    const config = configFor()

    expect(config.dataRoot).toBe(DATA_ROOT)
    expect(config.imagesDir).toBe(path.join(DATA_ROOT, 'images'))
    expect(config.logDir).toBe(path.join(DATA_ROOT, 'logs'))
    expect(config.cacheDir).toBe(path.join(DATA_ROOT, 'cache', 'thumbnails'))
    expect(config.cacheDir.startsWith(config.imagesDir)).toBe(false)
  })

  it('carries no endpoint when the layered configuration is unusable', () => {
    const config = configFor(null)

    // The page still has a Mirror, a log directory and a page to serve; only
    // the Gallery list is "not read" (#57).
    expect(config.galleryListEndpoint).toBeNull()
    expect(config.distDir).toBe(path.join(APP_ROOT, 'web', 'dist'))
    expect(config.imagesDir).toBe(path.join(DATA_ROOT, 'images'))
    expect(config.logDir).toBe(path.join(DATA_ROOT, 'logs'))
  })
})
