import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import type { ConfigValues } from '../../core/config-read.js'
import {
  configSourcesOf,
  parseConfig,
  readConfig,
  readLayeredConfig,
  siteConfig,
} from '../../core/config-read.js'

/** The two keys a Run's `.env` must supply; every other key has a default. */
const REQUIRED_ENV: NodeJS.ProcessEnv = {
  BASE_ORIGIN: 'https://re.bluepoch.com',
  PAGE_PATH: '/home/detail.html',
}

/** The validated values of an environment this file means to be valid. */
function valuesOf(env: NodeJS.ProcessEnv = REQUIRED_ENV): ConfigValues {
  const values = readConfig(env)
  if (values === null) throw new Error('the fixture environment must be valid')
  return values
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/**
 * A temporary installation in the packaged shape: `app/` holds the site
 * constants and `data/` sits beside it, exactly where the user layer lives.
 * Either file may be absent (`null`).
 */
interface Installation {
  appRoot: string
  dataRoot: string
}

function installationWith(files: { app?: string | null; user?: string | null } = {}): Installation {
  const install = fs.mkdtempSync(path.join(os.tmpdir(), 'config-layers-'))
  roots.push(install)
  const appRoot = path.join(install, 'app')
  const dataRoot = path.join(install, 'data')
  fs.mkdirSync(appRoot, { recursive: true })
  fs.mkdirSync(dataRoot, { recursive: true })
  if (files.app != null) fs.writeFileSync(path.join(appRoot, '.env'), files.app, 'utf8')
  if (files.user != null) fs.writeFileSync(path.join(dataRoot, 'user.env'), files.user, 'utf8')
  return { appRoot, dataRoot }
}

/** The two lines a minimal usable `.env` carries. */
const REQUIRED_LINES = `BASE_ORIGIN=${REQUIRED_ENV.BASE_ORIGIN}\nPAGE_PATH=${REQUIRED_ENV.PAGE_PATH}`

describe('readConfig', () => {
  it('reads a complete environment with the schema’s defaults filled in', () => {
    expect(valuesOf()).toEqual({
      BASE_ORIGIN: 'https://re.bluepoch.com',
      PAGE_PATH: '/home/detail.html',
      SESSION_NAME: 'bluepoch',
      IMAGES_DIR: 'images',
      BATCH_SIZE: 4,
      PLAYWRIGHT_CONFIG: '.playwright/config.json',
      LOG_DIR: 'logs',
    })
  })

  it('reads the values the environment does supply instead of the defaults', () => {
    const values = valuesOf({
      ...REQUIRED_ENV,
      SESSION_NAME: 'other-session',
      IMAGES_DIR: 'mirror',
      BATCH_SIZE: '8',
      PLAYWRIGHT_CONFIG: '.playwright/other.json',
      LOG_DIR: 'runs',
    })

    expect(values).toMatchObject({
      SESSION_NAME: 'other-session',
      IMAGES_DIR: 'mirror',
      BATCH_SIZE: 8,
      PLAYWRIGHT_CONFIG: '.playwright/other.json',
      LOG_DIR: 'runs',
    })
  })

  it('answers “no usable configuration” for an absent .env rather than throwing', () => {
    // A fresh clone: `.env` is gitignored, so the Console meets exactly this.
    expect(readConfig({})).toBeNull()
  })

  it('answers “no usable configuration” for a malformed value rather than throwing', () => {
    expect(readConfig({ ...REQUIRED_ENV, BASE_ORIGIN: 'not-a-url' })).toBeNull()
    expect(readConfig({ ...REQUIRED_ENV, PAGE_PATH: '' })).toBeNull()
    expect(readConfig({ ...REQUIRED_ENV, BATCH_SIZE: '0' })).toBeNull()
  })

  it('answers “no usable configuration” when a required key is missing', () => {
    expect(readConfig({ BASE_ORIGIN: 'https://re.bluepoch.com' })).toBeNull()
    expect(readConfig({ PAGE_PATH: '/home/detail.html' })).toBeNull()
  })
})

describe('configSourcesOf', () => {
  it('keeps the user layer inside the application root by default', () => {
    // A source tree's root is the repository, so its data is a child of it. The
    // package declares its sibling `data` through the environment instead — see
    // the explicit-data-root case below, which is the packaged shape.
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'config-sources-'))
    roots.push(appRoot)

    expect(configSourcesOf(appRoot)).toEqual({
      appRoot,
      dataRoot: path.join(appRoot, 'data'),
      appEnvFile: path.join(appRoot, '.env'),
      userEnvFile: path.join(appRoot, 'data', 'user.env'),
    })
  })

  it('accepts a data directory the caller names explicitly', () => {
    const install = fs.mkdtempSync(path.join(os.tmpdir(), 'config-sources-'))
    roots.push(install)
    const dataRoot = path.join(install, 'elsewhere')

    expect(configSourcesOf(path.join(install, 'app'), dataRoot).userEnvFile).toBe(
      path.join(dataRoot, 'user.env'),
    )
  })
})

describe('readLayeredConfig', () => {
  it('reads a valid app .env through the whole schema, defaults included', () => {
    const { appRoot, dataRoot } = installationWith({ app: REQUIRED_LINES })

    expect(readLayeredConfig({ appRoot, dataRoot, env: {} }).values).toEqual(valuesOf())
  })

  it('answers null for an absent app .env rather than throwing', () => {
    // The fresh clone the Console has to boot on: no file, no throw.
    expect(readLayeredConfig({ ...installationWith(), env: {} }).values).toBeNull()
  })

  it.each(['abc', '0'])(
    'answers null when a defaulted key in the app file is malformed (BATCH_SIZE=%s)',
    batchSize => {
      // The two required keys are fine; this is the file that used to pass the
      // two-key check and then die in the Run's own parse (#60).
      const { appRoot, dataRoot } = installationWith({
        app: `${REQUIRED_LINES}\nBATCH_SIZE=${batchSize}`,
      })

      expect(readLayeredConfig({ appRoot, dataRoot, env: {} }).values).toBeNull()
    },
  )

  it('answers null when the app file is missing a required key', () => {
    const { appRoot, dataRoot } = installationWith({
      app: `BASE_ORIGIN=${REQUIRED_ENV.BASE_ORIGIN}`,
    })

    expect(readLayeredConfig({ appRoot, dataRoot, env: {} }).values).toBeNull()
  })

  it('answers null when a required value is malformed', () => {
    const { appRoot, dataRoot } = installationWith({
      app: `BASE_ORIGIN=not-a-url\nPAGE_PATH=${REQUIRED_ENV.PAGE_PATH}`,
    })

    expect(readLayeredConfig({ appRoot, dataRoot, env: {} }).values).toBeNull()
  })

  it('lets the user layer win over the app layer', () => {
    const { appRoot, dataRoot } = installationWith({
      app: `${REQUIRED_LINES}\nBATCH_SIZE=2\nIMAGES_DIR=shipped-images`,
      user: 'BATCH_SIZE=8\nIMAGES_DIR=my-images',
    })

    expect(readLayeredConfig({ appRoot, dataRoot, env: {} }).values).toMatchObject({
      BATCH_SIZE: 8,
      IMAGES_DIR: 'my-images',
    })
  })

  it('lets the app layer win over the schema defaults', () => {
    const { appRoot, dataRoot } = installationWith({
      app: `${REQUIRED_LINES}\nIMAGES_DIR=shipped-images`,
    })

    expect(readLayeredConfig({ appRoot, dataRoot, env: {} }).values).toMatchObject({
      IMAGES_DIR: 'shipped-images',
      // A key neither file supplies still gets the schema's default.
      LOG_DIR: 'logs',
    })
  })

  it('lets the process environment win over both files, as dotenv/config does', () => {
    const { appRoot, dataRoot } = installationWith({
      app: `${REQUIRED_LINES}\nBATCH_SIZE=2\nIMAGES_DIR=shipped-images`,
      user: 'BATCH_SIZE=8\nIMAGES_DIR=my-images',
    })

    const values = readLayeredConfig({
      appRoot,
      dataRoot,
      env: { BATCH_SIZE: '6', IMAGES_DIR: 'shell-images' },
    }).values

    expect(values).toMatchObject({ BATCH_SIZE: 6, IMAGES_DIR: 'shell-images' })
  })

  it('lets the user layer supply the required keys the app file lacks', () => {
    // Precedence is about values, not about which file is allowed to hold them:
    // the schema is what decides usability, and the user layer is a real layer.
    const { appRoot, dataRoot } = installationWith({ app: null, user: REQUIRED_LINES })

    expect(readLayeredConfig({ appRoot, dataRoot, env: {} }).values).toEqual(valuesOf())
  })

  it('names the user file and its keys in one startup line when it contributes', () => {
    const { appRoot, dataRoot } = installationWith({
      app: `${REQUIRED_LINES}\nBATCH_SIZE=2`,
      user: 'BATCH_SIZE=8\nIMAGES_DIR=my-images',
    })

    const read = readLayeredConfig({ appRoot, dataRoot, env: {} })

    expect(read.notice).toContain(path.join(dataRoot, 'user.env'))
    expect(read.notice).toContain('IMAGES_DIR')
    expect(read.notice).toContain('BATCH_SIZE')
    // One line: the log record is the point, and a multi-line notice would be
    // read as several records.
    expect(read.notice).not.toContain('\n')
  })

  it.each([null, '', '# only a comment\n'])(
    'says nothing when the user layer contributes nothing (%j)',
    user => {
      const { appRoot, dataRoot } = installationWith({ app: REQUIRED_LINES, user })

      const read = readLayeredConfig({ appRoot, dataRoot, env: {} })

      expect(read.values).not.toBeNull()
      expect(read.notice).toBeNull()
    },
  )

  it('says nothing when the layered configuration as a whole is unusable', () => {
    // A malformed user override does not "load" a configuration; the setup
    // notice (or the Run's own throw) is what has to explain it.
    const { appRoot, dataRoot } = installationWith({
      app: REQUIRED_LINES,
      user: 'BATCH_SIZE=abc',
    })

    const read = readLayeredConfig({ appRoot, dataRoot, env: {} })

    expect(read.values).toBeNull()
    expect(read.notice).toBeNull()
  })
})

describe('parseConfig', () => {
  it('throws on the absent environment the Console tolerates — the Run’s fail-fast', () => {
    expect(() => parseConfig({})).toThrow(ZodError)
  })

  it('returns the same values the tolerant read would', () => {
    expect(parseConfig(REQUIRED_ENV)).toEqual(valuesOf())
  })
})

describe('siteConfig', () => {
  const projectRoot = path.resolve('/srv/re1999')
  const defaultImagesDir = path.join(projectRoot, 'images')

  it('reads the same Mirror and Run log directory a Run would when .env supplies nothing', () => {
    // The Console's defaults are the schema's: the page degrades to "not read",
    // never to a different Mirror than the Run writes into.
    expect(siteConfig(projectRoot, null)).toEqual({
      sessionName: 'bluepoch',
      imagesDir: defaultImagesDir,
      logDir: path.join(projectRoot, 'logs'),
      galleryStateFile: path.join(defaultImagesDir, '.gallery-state.json'),
      runCacheDir: path.join(projectRoot, '.run-cache'),
    })
  })

  it('follows the environment’s own directories when it has them', () => {
    const site = siteConfig(
      projectRoot,
      valuesOf({ ...REQUIRED_ENV, IMAGES_DIR: 'mirror', LOG_DIR: 'runs' }),
    )

    expect(site.imagesDir).toBe(path.join(projectRoot, 'mirror'))
    // The Gallery state stays beside the Mirror it describes (ADR 0006).
    expect(site.galleryStateFile).toBe(
      path.join(path.join(projectRoot, 'mirror'), '.gallery-state.json'),
    )
    expect(site.logDir).toBe(path.join(projectRoot, 'runs'))
  })
})
