import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import type { ConfigValues } from '../../core/config-read.js'
import { parseConfig, readConfig, readProjectConfig, siteConfig } from '../../core/config-read.js'

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

/** A temporary project root holding the given `.env` text, or none at all. */
function projectRootWith(envText: string | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-read-'))
  roots.push(root)
  if (envText !== null) fs.writeFileSync(path.join(root, '.env'), envText, 'utf8')
  return root
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

describe('readProjectConfig', () => {
  it('reads a valid .env through the whole schema, defaults included', () => {
    const root = projectRootWith(REQUIRED_LINES)

    expect(readProjectConfig(root, {})).toEqual(valuesOf())
  })

  it('answers null for an absent .env rather than throwing', () => {
    // The fresh clone the Console has to boot on: no file, no throw.
    expect(readProjectConfig(projectRootWith(null), {})).toBeNull()
  })

  it.each(['abc', '0'])(
    'answers null when a defaulted key in the file is malformed (BATCH_SIZE=%s)',
    batchSize => {
      // The two required keys are fine; this is the file that used to pass the
      // two-key check and then die in the Run's own parse (#60).
      const root = projectRootWith(`${REQUIRED_LINES}\nBATCH_SIZE=${batchSize}`)

      expect(readProjectConfig(root, {})).toBeNull()
    },
  )

  it('lets the real environment win over the file, as dotenv/config does', () => {
    const root = projectRootWith(
      `BASE_ORIGIN=https://file.example\nPAGE_PATH=/file.html\nBATCH_SIZE=2`,
    )

    const values = readProjectConfig(root, {
      BASE_ORIGIN: 'https://shell.example',
      BATCH_SIZE: '8',
    })

    expect(values).toMatchObject({
      BASE_ORIGIN: 'https://shell.example',
      PAGE_PATH: '/file.html',
      BATCH_SIZE: 8,
    })
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
