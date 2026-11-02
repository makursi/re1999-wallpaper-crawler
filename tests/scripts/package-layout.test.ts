// ── What may enter the flat package (#118) ──────────────────────────
//
// The archive's extracted root **is** the program root (spec #116), so the
// contents are a short list of names: the one product document, the licence, the
// shipped manifest, the lockfile generated against it, the npm configuration,
// the site configuration, the two entries, and the page. Everything else is
// refused — the runtime binary a flat package does not carry, the dependency
// tree the user's `npm install` creates, the data directory the first start
// creates, and every source, test, script and repository document.
//
// The predicate is the deliverable: `scripts/package.ts` refuses to write the
// zip when the collected list holds one path outside it. The other rules here
// are the page's one wildcard, the required entries that make a legal archive
// still a broken one, and the lockfile's agreement with the shipped manifest.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { parse as parseDotenv } from 'dotenv'
import { afterEach, describe, expect, it } from 'vitest'

import { readConfig } from '../../core/config-read.js'
import {
  ARCHIVE_ROOT_FILES,
  archiveRequiredEntries,
  assertPackagedPaths,
  isPackagedPath,
  lockfileCommand,
  lockfileRefusal,
  NPMRC_FILE_NAME,
  NPMRC_TEXT,
  packagePathOffenders,
  readSiteEnv,
} from '../../scripts/package-layout.js'
import type { ShippedManifest } from '../../scripts/package-manifest.js'

const roots: string[] = []

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** The shipped manifest, as `scripts/build.ts` writes it (#117). */
const MANIFEST: ShippedManifest = {
  name: 're1999-wallpaper-crawler',
  version: '2.0.0',
  private: true,
  type: 'module',
  engines: { node: '>=22.22.1' },
  scripts: { start: 'node server.js' },
  dependencies: { sharp: '^0.34.4' },
}

/** A lockfile as npm writes it for that manifest, trimmed to what matters. */
function lockfile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      name: MANIFEST.name,
      version: MANIFEST.version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: MANIFEST.name,
          version: MANIFEST.version,
          dependencies: { sharp: '^0.34.4' },
        },
        'node_modules/sharp': { version: '0.34.4', license: 'Apache-2.0' },
        'node_modules/@img/sharp-win32-x64': { version: '0.34.4', license: 'Apache-2.0' },
        ...overrides,
      },
    },
    null,
    2,
  )
}

describe('isPackagedPath', () => {
  it('lets the named root entries — the program root is the archive root', () => {
    expect([...ARCHIVE_ROOT_FILES].toSorted()).toEqual([
      '.env',
      '.npmrc',
      'LICENSE.txt',
      'README.md',
      'package-lock.json',
      'package.json',
      'run.js',
      'server.js',
    ])
    for (const archivePath of ARCHIVE_ROOT_FILES) {
      expect(isPackagedPath(archivePath)).toBe(true)
    }
  })

  it('lets the page under web/dist, and nothing else under web', () => {
    for (const archivePath of [
      'web/dist/index.html',
      'web/dist/assets/index-abc123.js',
      'web/dist/assets/index-abc123.css',
      'web/dist/assets/fonts/subset.woff2',
    ]) {
      expect(isPackagedPath(archivePath)).toBe(true)
    }
  })

  it('refuses the runtime, the dependency tree, the launchers and the data directory', () => {
    // The shape this ticket replaces: a self-contained Windows package whose
    // root was two folders. Every one of these is now refused by shape.
    for (const archivePath of [
      'node.exe',
      'app/server.js',
      'app/node_modules/sharp/package.json',
      'node_modules/sharp/package.json',
      'node_modules/@img/sharp-win32-x64/sharp.node',
      '启动.bat',
      '更新.bat',
      '使用说明.txt',
      'update.js',
      'data',
      'data/images/wallpaper.jpg',
      'data/logs/2026-09-15.jsonl',
      'data/user.env',
      'data/cache/thumbnails/x.webp',
      'data/instance.json',
      'images/0001.jpg',
      'logs/run.jsonl',
    ]) {
      expect(isPackagedPath(archivePath)).toBe(false)
    }
  })

  it('refuses the repository documents, sources, tests, scripts and hidden development configuration', () => {
    for (const archivePath of [
      'CHANGELOG.md',
      'AGENTS.md',
      'CONTEXT.md',
      'CONTEXT-MAP.md',
      'HISTORY.md',
      'README.en.md',
      'core/main.ts',
      'web/src/App.vue',
      'web/server/console.ts',
      'web/distx/index.html',
      'web/vite.config.ts',
      'tests/scripts/package-layout.test.ts',
      'scripts/package.ts',
      'packaging/site.env',
      'packaging/LICENSE.txt',
      'packaging/使用说明.txt',
      '.github/workflows/ci.yml',
      '.oxlintrc.json',
      '.oxfmtrc.json',
      '.gitignore',
      '.env.local',
      'pnpm-lock.yaml',
      'tsconfig.json',
      'vitest.config.ts',
    ]) {
      expect(isPackagedPath(archivePath)).toBe(false)
    }
  })

  it('refuses the README style guide — a development document never ships', () => {
    // The guide governs the one shipped document from the repository only. The
    // whitelist has no name it could enter under, so "development document" is a
    // property the packager enforces rather than a note beside it.
    expect(isPackagedPath('docs/readme-styleguide.md')).toBe(false)
    expect(archiveRequiredEntries()).not.toContain('docs/readme-styleguide.md')
  })

  it('refuses relative escapes, Windows separators, directory-only paths and empty paths', () => {
    for (const archivePath of [
      '',
      '/',
      '/server.js',
      'C:/Windows/System32/node.exe',
      'server\\js',
      '../.env',
      'web/../../.env',
      'web\\dist\\index.html',
      'web/dist',
      'web/dist/',
      'web//dist/index.html',
      'web/dist/../server.js',
    ]) {
      expect(isPackagedPath(archivePath)).toBe(false)
    }
  })
})

describe('archiveRequiredEntries', () => {
  it('requires every named root entry and the page entry', () => {
    const required = archiveRequiredEntries()

    for (const archivePath of [...ARCHIVE_ROOT_FILES, 'web/dist/index.html']) {
      expect(required).toContain(archivePath)
    }
  })

  it('requires nothing the whitelist itself refuses, or no package could ever pass', () => {
    for (const archivePath of archiveRequiredEntries()) {
      expect(isPackagedPath(archivePath)).toBe(true)
    }
  })
})

describe('packagePathOffenders', () => {
  it('names every path the whitelist refuses, and only those', () => {
    const collected = [
      'README.md',
      'server.js',
      'web/dist/index.html',
      'data/images/leak.jpg',
      'node_modules/sharp/package.json',
      '.env',
    ]

    expect(packagePathOffenders(collected)).toEqual([
      'data/images/leak.jpg',
      'node_modules/sharp/package.json',
    ])
  })

  it('assertPackagedPaths throws loudly, naming each offender, so a poisoned list cannot be zipped', () => {
    expect(() => assertPackagedPaths(['README.md', 'data/user.env', '.git/config'])).toThrow(
      /data\/user\.env[\s\S]*\.git\/config/,
    )
    expect(() =>
      assertPackagedPaths(['README.md', 'server.js', 'web/dist/index.html']),
    ).not.toThrow()
  })
})

describe('NPMRC_TEXT', () => {
  it('is the exact engine-strict configuration the archive carries, not just a file name', () => {
    // The extracted copy is what a player's `npm install` obeys, so the text is
    // the assertion: a root entry named `.npmrc` with different bytes would pass
    // a presence check and enforce nothing.
    expect(NPMRC_TEXT).toBe('engine-strict=true\n')
    expect(ARCHIVE_ROOT_FILES).toContain(NPMRC_FILE_NAME)
    expect(archiveRequiredEntries()).toContain(NPMRC_FILE_NAME)
  })
})

describe('readSiteEnv', () => {
  it('reads the committed template as a configuration the schema accepts', () => {
    const template = readSiteEnv(path.resolve(import.meta.dirname, '..', '..', 'packaging'))

    expect(template.baseOrigin).toBe('https://re.bluepoch.com')
    // The template is not a second schema: the real one has to accept it.
    expect(readConfig(parseDotenv(template.text))).not.toBeNull()
  })

  it('refuses a template the schema cannot use, naming the file', () => {
    const packaging = tempRoot('package-site-')
    fs.writeFileSync(path.join(packaging, 'site.env'), 'BATCH_SIZE=4\n', 'utf8')

    expect(() => readSiteEnv(packaging)).toThrow(/site\.env[\s\S]*BASE_ORIGIN/)
  })

  it('refuses a missing template rather than falling back to the working tree .env', () => {
    const packaging = tempRoot('package-site-')

    expect(() => readSiteEnv(packaging)).toThrow(/site\.env/)
  })
})

describe('the lockfile generation', () => {
  it('resolves the shipped manifest into a lockfile only: no install, runtime dependencies only', () => {
    // The spec's command: `npm install --package-lock-only --omit=dev
    // --no-audit --no-fund`. A plain install would create `node_modules` in the
    // seed directory and make packaging slower and noisier for nothing.
    expect(lockfileCommand()).toBe(
      'npm install --package-lock-only --omit=dev --no-audit --no-fund',
    )
  })
})

describe('lockfileRefusal', () => {
  it('accepts a lockfile npm generated from the shipped manifest', () => {
    expect(lockfileRefusal(lockfile(), MANIFEST.dependencies)).toBeNull()
  })

  it('refuses a lockfile generated against a different manifest', () => {
    const stale = lockfile({
      '': { name: MANIFEST.name, version: MANIFEST.version, dependencies: { sharp: '^0.33.0' } },
    })

    expect(lockfileRefusal(stale, MANIFEST.dependencies)).toMatch(/sharp/)
  })

  it('refuses a lockfile that does not resolve the manifest dependency', () => {
    const unresolved = lockfile({ 'node_modules/sharp': { license: 'Apache-2.0' } })

    expect(lockfileRefusal(unresolved, MANIFEST.dependencies)).toMatch(/sharp/)
  })

  it('refuses text that is not a lockfile', () => {
    expect(lockfileRefusal('not json at all', MANIFEST.dependencies)).not.toBeNull()
    expect(lockfileRefusal(JSON.stringify({ packages: {} }), MANIFEST.dependencies)).not.toBeNull()
  })
})
