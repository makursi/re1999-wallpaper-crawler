// ── What may enter the portable archive (#86) ───────────────────────
//
// The release promise is not "I remembered to check": the archive's contents are
// a whitelist, and the packager refuses to write the zip when the collected list
// holds one path outside it. So the predicate is the deliverable, and these are
// the rules it has to hold:
//
//   - the archive root carries the launcher and the documents that ship beside
//     it, and nothing else — no `data\`, no owner's `.env`, no `.git`;
//   - `app\` carries the built program, the page, `node.exe`, the generated
//     `.env`, and sharp's runtime closure — no sources, tests or dev tooling;
//   - a path under a data directory, a gitignored path, or a Windows-shaped
//     relative escape is refused, because those are how an owner's images,
//     logs and local configuration would physically enter a release.
//
// The template and the runtime are two more decisions with their own rules: the
// generated `app\.env` comes from a committed template (never the working
// tree's), and `node.exe` comes from the running Node unless #88 supplies one.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { parse as parseDotenv } from 'dotenv'
import { afterEach, describe, expect, it } from 'vitest'

import { readConfig } from '../../core/config-read.js'
import {
  assertPackagedPaths,
  isPackagedPath,
  nodeRuntimeFile,
  packagePathOffenders,
  readSiteEnv,
  rootPackageFiles,
} from '../../scripts/package-layout.js'

const roots: string[] = []

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('isPackagedPath', () => {
  it('lets the archive root hold the launcher and the documents that ship beside it', () => {
    // #85 shipped 启动.bat; #87 and #89 add these two. The seam is the
    // extension, not a filename list, so those tickets add a file and no code.
    expect(isPackagedPath('启动.bat')).toBe(true)
    expect(isPackagedPath('更新.bat')).toBe(true)
    expect(isPackagedPath('使用说明.txt')).toBe(true)
  })

  it('lets the built program, the page, the runtime and the generated configuration', () => {
    for (const archivePath of [
      'app/server.js',
      'app/run.js',
      'app/package.json',
      'app/node.exe',
      'app/.env',
      'app/web/dist/index.html',
      'app/web/dist/assets/index-abc123.js',
    ]) {
      expect(isPackagedPath(archivePath)).toBe(true)
    }
  })

  it('lets sharp and the packages sharp itself loads at run time', () => {
    // `sharp` is the build's one external, but it is not self-contained: its
    // own metadata names four runtime packages, and the package carries them
    // beside it (`scripts/package-layout.ts` is where that closure is argued).
    for (const archivePath of [
      'app/node_modules/sharp/package.json',
      'app/node_modules/sharp/dist/index.cjs',
      'app/node_modules/@img/colour/index.cjs',
      'app/node_modules/@img/sharp-win32-x64/sharp.node',
      'app/node_modules/detect-libc/lib/detect-libc.js',
      'app/node_modules/semver/index.js',
    ]) {
      expect(isPackagedPath(archivePath)).toBe(true)
    }
  })

  it('refuses the data directory, the owner local files and the gitignored locations', () => {
    // This is the failure the whitelist exists for: a release carrying the
    // owner's images, logs or `.env` because the packager collected a directory
    // it should never have looked at.
    for (const archivePath of [
      'data',
      'data/images/wallpaper.jpg',
      'data/logs/2026-09-15.jsonl',
      'data/user.env',
      'data/cache/thumbnails/x.webp',
      'data/instance.json',
      'images/0001.jpg',
      'logs/run.jsonl',
      '.env',
      '.env.local',
      '.git/config',
      'build/server.js',
      'web/dist/index.html',
      'web/.console-cache/thumbnail.webp',
      'node_modules/vite/package.json',
      'run.log',
    ]) {
      expect(isPackagedPath(archivePath)).toBe(false)
    }
  })

  it('refuses sources, tests and development tooling', () => {
    for (const archivePath of [
      'core/main.ts',
      'web/src/App.vue',
      'web/server/console.ts',
      'tests/scripts/package-layout.test.ts',
      'scripts/build.ts',
      'packaging/site.env',
      '.oxlintrc.json',
      '.oxfmtrc.json',
      'README.md',
      'package.json',
      'pnpm-lock.yaml',
      '启动.bat.orig',
    ]) {
      expect(isPackagedPath(archivePath)).toBe(false)
    }
  })

  it('refuses anything outside the allow-list even under app', () => {
    for (const archivePath of [
      'app/web/src/App.vue',
      'app/core/main.ts',
      'app/data/images/x.jpg',
      'app/.env.local',
      'app/node_modules/vite/package.json',
      'app/node_modules/@img-evil/x.node',
      'app/node_modules/.bin/semver',
    ]) {
      expect(isPackagedPath(archivePath)).toBe(false)
    }
  })

  it('refuses relative escapes, Windows separators and empty paths', () => {
    for (const archivePath of [
      '',
      '/',
      '/app/server.js',
      'C:/Windows/System32/node.exe',
      'app\\server.js',
      'app\\..\\data\\images\\x.jpg',
      '../.env',
      'app/../../.env',
      'app/web/dist/',
      'app//server.js',
    ]) {
      expect(isPackagedPath(archivePath)).toBe(false)
    }
  })
})

describe('packagePathOffenders', () => {
  it('names every path the whitelist refuses, and only those', () => {
    const collected = [
      '启动.bat',
      'app/server.js',
      'data/images/leak.jpg',
      'app/node_modules/sharp/package.json',
      '.env',
    ]

    expect(packagePathOffenders(collected)).toEqual(['data/images/leak.jpg', '.env'])
  })

  it('assertPackagedPaths throws loudly, naming each offender, so a poisoned list cannot be zipped', () => {
    expect(() => assertPackagedPaths(['启动.bat', 'data/user.env', '.git/config'])).toThrow(
      /data\/user\.env[\s\S]*\.git\/config/,
    )
    expect(() => assertPackagedPaths(['启动.bat', 'app/server.js'])).not.toThrow()
  })
})

describe('rootPackageFiles', () => {
  it('takes every .bat and .txt directly in packaging/, so #87 and #89 need no packager change', () => {
    const packaging = tempRoot('package-root-')
    for (const name of ['启动.bat', '更新.bat', '使用说明.txt', 'site.env', '.hidden.bat']) {
      fs.writeFileSync(path.join(packaging, name), `# ${name}\r\n`, 'utf8')
    }
    fs.mkdirSync(path.join(packaging, '文档.txt'))
    fs.mkdirSync(path.join(packaging, 'nested'))
    fs.writeFileSync(path.join(packaging, 'nested', 'deep.bat'), '@echo off\r\n', 'utf8')

    expect(rootPackageFiles(packaging).toSorted()).toEqual(['使用说明.txt', '启动.bat', '更新.bat'])
  })

  it('does not mistake the site-constants template for a file the owner reads', () => {
    const packaging = tempRoot('package-root-')
    fs.writeFileSync(path.join(packaging, 'site.env'), 'BASE_ORIGIN=https://example.test\n', 'utf8')

    expect(rootPackageFiles(packaging)).toEqual([])
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

describe('nodeRuntimeFile', () => {
  it('uses the running Node by default', () => {
    const runtime = path.join(tempRoot('package-node-'), 'node.exe')
    fs.writeFileSync(runtime, 'node', 'utf8')

    expect(nodeRuntimeFile({ execPath: runtime, env: {} })).toBe(path.resolve(runtime))
  })

  it('fails with the way in when the running Node has no executable to copy', () => {
    // #88 will supply the official runtime; until then a local package either
    // has the running Node's own binary or it does not build at all.
    expect(() =>
      nodeRuntimeFile({ execPath: path.join(os.tmpdir(), 'absent-node.exe'), env: {} }),
    ).toThrow(/RE1999_NODE_EXE/)
  })

  it('takes an explicitly supplied runtime, which is the seam #88 uses', () => {
    const runtime = path.join(tempRoot('package-node-'), 'official-node.exe')
    fs.writeFileSync(runtime, 'node', 'utf8')

    expect(nodeRuntimeFile({ execPath: 'not-the-one', env: { RE1999_NODE_EXE: runtime } })).toBe(
      path.resolve(runtime),
    )
  })
})
