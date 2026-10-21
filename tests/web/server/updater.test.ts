// ── The update: one folder swapped, the user's data untouched (#87) ─
//
// This is the only module in the repository that removes a directory the user
// can see, so its tests are not allowed to trust it: every one of them builds a
// real installation on a temporary tree, runs the real flow, and reads the
// result back off the filesystem. `data\` is compared as a map of relative path
// → SHA-256, which is byte-identity and not a list of files that "look right".
//
// The installation is the package's own shape (#86): `<install>\app` beside
// `<install>\data`. The update runs from a second, newly extracted package
// (`<download>\app`), which is why these tests always build two trees: what the
// user has, and what they just downloaded.

import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import type { Server } from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { writeInstallPointer } from '../../../web/server/installation.js'
import { instanceRecordPath } from '../../../web/server/instance-record.js'
import { INSTANCE_PROBE_PATH } from '../../../web/server/routes/instance.js'
import { programTreePath, updateInstallation } from '../../../web/server/updater.js'

const roots: string[] = []

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** One extracted package, as `pnpm package` lays it out: `app\` beside the launchers. */
function makePackage(root: string, version: string, marker: string): void {
  const app = path.join(root, 'app')
  fs.mkdirSync(path.join(app, 'web', 'dist'), { recursive: true })
  fs.writeFileSync(path.join(root, '启动.bat'), '@echo off\r\n', 'utf8')
  fs.writeFileSync(path.join(root, '更新.bat'), '@echo off\r\n', 'utf8')
  fs.writeFileSync(
    path.join(app, 'package.json'),
    `${JSON.stringify({ name: 're1999-wallpaper-crawler', version }, null, 2)}\n`,
    'utf8',
  )
  fs.writeFileSync(path.join(app, 'server.js'), `// console ${marker}\n`, 'utf8')
  fs.writeFileSync(path.join(app, 'run.js'), `// run ${marker}\n`, 'utf8')
  fs.writeFileSync(path.join(app, 'update.js'), `// updater ${marker}\n`, 'utf8')
  fs.writeFileSync(path.join(app, 'node.exe'), `node ${marker}\n`, 'utf8')
  fs.writeFileSync(path.join(app, 'web', 'dist', 'index.html'), `<html>${marker}</html>`, 'utf8')
  fs.writeFileSync(path.join(app, '.env'), 'BASE_ORIGIN=https://re.bluepoch.com\n', 'utf8')
}

/**
 * One installed package with the user's things in it: a Mirror, a Run log, the
 * thumbnail cache, `user.env`, the layout marker and the single-instance record.
 */
function makeInstallation(root: string, version: string, marker: string): void {
  makePackage(root, version, marker)
  const data = path.join(root, 'data')
  fs.mkdirSync(path.join(data, 'images'), { recursive: true })
  fs.mkdirSync(path.join(data, 'logs'), { recursive: true })
  fs.mkdirSync(path.join(data, 'cache', 'thumbnails'), { recursive: true })
  fs.writeFileSync(path.join(data, 'layout.json'), '{"version":1}\n', 'utf8')
  fs.writeFileSync(path.join(data, 'images', '1013_8dee54e8.png'), 'wallpaper-bytes', 'utf8')
  fs.writeFileSync(path.join(data, 'images', '.gallery-state.json'), '{"ids":[1013]}\n', 'utf8')
  fs.writeFileSync(
    path.join(data, 'logs', 'run-2026-10-18T01-03-31.jsonl'),
    '{"type":"run_start"}\n',
    'utf8',
  )
  fs.writeFileSync(path.join(data, 'cache', 'thumbnails', '1013.webp'), 'thumb-bytes', 'utf8')
  fs.writeFileSync(path.join(data, 'user.env'), 'BATCH_SIZE=4\n', 'utf8')
  // The record a crashed boot leaves behind: a real file the updater must not
  // touch, and a port nothing answers on.
  fs.writeFileSync(
    path.join(data, 'instance.json'),
    `${JSON.stringify({ version: 1, port: 1, token: 'dead-beef', pid: 424242 }, null, 2)}\n`,
    'utf8',
  )
}

/** Every file under `root`: relative path → SHA-256 of its bytes. */
function snapshot(root: string): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else
        files.set(
          path.relative(root, absolute).replaceAll('\\', '/'),
          createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
        )
    }
  }
  walk(root)
  return files
}

function text(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

describe('updateInstallation', () => {
  it('replaces app\\ and leaves every byte of data\\ exactly as it was', async () => {
    const base = tempRoot('updater-')
    const install = path.join(base, '安装 路径')
    const download = path.join(base, 'Downloads', 're1999-v1.0.1')
    makeInstallation(install, '1.0.0', 'old')
    makePackage(download, '1.0.1', 'new')

    const localAppData = path.join(base, 'AppData')
    writeInstallPointer({
      installRoot: install,
      localAppData,
      now: new Date('2026-10-21T12:00:00.000Z'),
    })

    const dataFile = path.join(install, 'data')
    const before = snapshot(dataFile)

    const outcome = await updateInstallation({ packageRoot: download }, { localAppData })

    expect(outcome).toMatchObject({
      kind: 'updated',
      installRoot: path.resolve(install),
      previousVersion: '1.0.0',
      installedVersion: '1.0.1',
    })

    // The program directory is the new one, and the old one is the fallback.
    expect(text(path.join(install, 'app', 'server.js'))).toContain('new')
    expect(text(path.join(install, 'app', 'node.exe'))).toContain('new')
    expect(text(path.join(install, 'app.old', 'server.js'))).toContain('old')
    expect(text(path.join(install, 'app.old', 'node.exe'))).toContain('old')

    // The data directory is the same directory, byte for byte — the layout
    // marker and the single-instance record included.
    expect(snapshot(dataFile)).toEqual(before)
  })
})

describe('updateInstallation refusals', () => {
  /** An installation and a freshly extracted package, in one temporary base. */
  function scene(): {
    base: string
    install: string
    download: string
    localAppData: string
  } {
    const base = tempRoot('updater-refusal-')
    const install = path.join(base, 'install')
    const download = path.join(base, 'download', 'package')
    makeInstallation(install, '1.0.0', 'old')
    makePackage(download, '1.0.1', 'new')
    return { base, install, download, localAppData: path.join(base, 'AppData') }
  }

  it('says how to point at the installation when no launch has recorded one', async () => {
    const { install, download, localAppData } = scene()
    const before = snapshot(install)

    const outcome = await updateInstallation({ packageRoot: download }, { localAppData })

    expect(outcome).toMatchObject({ kind: 'refused', code: 'no-installation' })
    // The one instruction that resolves it: drag the old launcher onto the new
    // updater. A refusal that only says "not found" leaves the user stuck.
    expect(outcome.kind === 'refused' ? outcome.message : '').toContain('启动.bat')
    expect(snapshot(install)).toEqual(before)
  })

  it('says the recorded location is gone, and how to point at the new one', async () => {
    const { base, install, download, localAppData } = scene()
    // A pointer written when the folder was somewhere it is not any more.
    const vanished = path.join(base, 'old place')
    makeInstallation(vanished, '1.0.0', 'old')
    writeInstallPointer({ installRoot: vanished, localAppData })
    fs.rmSync(vanished, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(install), { recursive: true })
    fs.renameSync(install, path.join(base, 'moved install'))
    const moved = path.join(base, 'moved install')
    const before = snapshot(moved)

    const outcome = await updateInstallation({ packageRoot: download }, { localAppData })

    expect(outcome).toMatchObject({ kind: 'refused', code: 'stale-pointer' })
    expect(outcome.kind === 'refused' ? outcome.message : '').toContain(path.resolve(vanished))
    expect(outcome.kind === 'refused' ? outcome.message : '').toContain('启动.bat')
    expect(snapshot(moved)).toEqual(before)
  })

  it('updates a moved installation when the old launcher is dragged onto the updater', async () => {
    const { base, install, download, localAppData } = scene()
    // The pointer still names the address the installation was at before the
    // user renamed/moved the folder; the drag supplies the real one.
    writeInstallPointer({ installRoot: install, localAppData })
    const moved = path.join(base, 'D 盘', '我的 壁纸工具')
    fs.mkdirSync(path.dirname(moved), { recursive: true })
    fs.renameSync(install, moved)

    const outcome = await updateInstallation(
      { packageRoot: download, targetArgument: path.join(moved, '启动.bat') },
      { localAppData },
    )

    expect(outcome).toMatchObject({
      kind: 'updated',
      installRoot: path.resolve(moved),
      previousVersion: '1.0.0',
      installedVersion: '1.0.1',
    })
    expect(text(path.join(moved, 'app', 'server.js'))).toContain('new')
    expect(fs.existsSync(path.join(moved, 'data', 'images', '1013_8dee54e8.png'))).toBe(true)
  })

  it('accepts the program directory a user might drag, and names its installation', async () => {
    const { base, install, download, localAppData } = scene()
    writeInstallPointer({ installRoot: install, localAppData })
    const moved = path.join(base, 'moved')
    fs.mkdirSync(path.dirname(moved), { recursive: true })
    fs.renameSync(install, moved)

    const outcome = await updateInstallation(
      { packageRoot: download, targetArgument: path.join(moved, 'app') },
      { localAppData },
    )

    expect(outcome).toMatchObject({ kind: 'updated', installRoot: path.resolve(moved) })
  })

  it('refuses a target that does not exist, without touching the package', async () => {
    const { base, download, localAppData } = scene()
    const gone = path.join(base, 'not there')

    const outcome = await updateInstallation(
      { packageRoot: download, targetArgument: gone },
      { localAppData },
    )

    expect(outcome).toMatchObject({ kind: 'refused', code: 'missing-target' })
    expect(outcome.kind === 'refused' ? outcome.message : '').toContain(path.resolve(gone))
    expect(fs.existsSync(path.join(download, 'app', 'server.js'))).toBe(true)
  })

  it('refuses a folder that is not an installation: no app\\ or no data\\', async () => {
    const { base, download } = scene()
    const localAppData = path.join(base, 'AppData')

    const noApp: string = path.join(base, 'no-app')
    fs.mkdirSync(path.join(noApp, 'data', 'images'), { recursive: true })
    const noData = path.join(base, 'no-data')
    fs.mkdirSync(path.join(noData, 'app'), { recursive: true })

    for (const target of [noApp, noData]) {
      const outcome = await updateInstallation(
        { packageRoot: download, targetArgument: target },
        { localAppData },
      )
      expect(outcome).toMatchObject({ kind: 'refused', code: 'not-an-installation' })
      expect(outcome.kind === 'refused' ? outcome.message : '').toContain(path.resolve(target))
    }

    // Nothing was created inside either folder: a refusal is not a half-update.
    expect(fs.readdirSync(noApp)).toEqual(['data'])
    expect(fs.readdirSync(noData)).toEqual(['app'])
  })

  it('refuses when the updater is the installation, so the new app\\ is not itself', async () => {
    const { install, localAppData } = scene()
    fs.writeFileSync(path.join(install, '更新.bat'), '@echo off\r\n', 'utf8')
    const before = snapshot(install)

    // The user extracted the new zip on top of the old installation and is
    // running that copy's updater: there is no second `app\` to swap in.
    const outcome = await updateInstallation(
      { packageRoot: install, targetArgument: path.join(install, '更新.bat') },
      { localAppData },
    )

    expect(outcome).toMatchObject({ kind: 'refused', code: 'same-root' })
    expect(outcome.kind === 'refused' ? outcome.message : '').toContain('解压')
    expect(snapshot(install)).toEqual(before)
  })

  it('refuses an incomplete new package, naming the files it lacks', async () => {
    const { install, download, localAppData } = scene()
    writeInstallPointer({ installRoot: install, localAppData })
    fs.rmSync(path.join(download, 'app', 'node.exe'))
    const before = snapshot(install)

    const outcome = await updateInstallation({ packageRoot: download }, { localAppData })

    expect(outcome).toMatchObject({ kind: 'refused', code: 'incomplete-package' })
    expect(outcome.kind === 'refused' ? outcome.message : '').toContain('node.exe')
    expect(snapshot(install)).toEqual(before)
  })
})

describe('updateInstallation against a running Console', () => {
  const servers: Server[] = []

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(server => {
        return new Promise<void>(resolve => server.close(() => resolve()))
      }),
    )
  })

  /** A real loopback service answering the record's handshake, as #82 defines it. */
  async function runningConsole(dataRoot: string, token: string): Promise<Server> {
    const server = http.createServer((request, response) => {
      if (request.url === `${INSTANCE_PROBE_PATH}?token=${encodeURIComponent(token)}`) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"ok":true}')
        return
      }
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{"error":"not found"}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    servers.push(server)

    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    fs.writeFileSync(
      instanceRecordPath(dataRoot),
      `${JSON.stringify({ version: 1, port: address.port, token, pid: process.pid }, null, 2)}\n`,
      'utf8',
    )
    return server
  }

  it('asks the user to close the window first, and changes nothing', async () => {
    const base = tempRoot('updater-running-')
    const install = path.join(base, 'install')
    const download = path.join(base, 'download')
    makeInstallation(install, '1.0.0', 'old')
    makePackage(download, '1.0.1', 'new')
    const localAppData = path.join(base, 'AppData')
    writeInstallPointer({ installRoot: install, localAppData })
    const dataDir = path.join(install, 'data')
    await runningConsole(dataDir, 'a-token-from-the-running-boot')
    const before = snapshot(dataDir)

    const outcome = await updateInstallation({ packageRoot: download }, { localAppData })

    expect(outcome).toMatchObject({ kind: 'refused', code: 'running' })
    const message = outcome.kind === 'refused' ? outcome.message : ''
    expect(message).toContain('关闭')
    // The refusal names the page the running service is serving, so the user can
    // find the window they have to close.
    expect(message).toContain('127.0.0.1')
    // Program and data are untouched: a refusal is not a half-update.
    expect(text(path.join(install, 'app', 'server.js'))).toContain('old')
    expect(fs.existsSync(path.join(install, 'app.old'))).toBe(false)
    expect(snapshot(dataDir)).toEqual(before)
  })
})

describe('updateInstallation failures', () => {
  it('restores the old app\\ when the copy dies halfway, and never touches data\\', async () => {
    const base = tempRoot('updater-rollback-')
    const install = path.join(base, 'install')
    const download = path.join(base, 'download')
    makeInstallation(install, '1.0.0', 'old')
    makePackage(download, '1.0.1', 'new')
    const localAppData = path.join(base, 'AppData')
    writeInstallPointer({ installRoot: install, localAppData })
    const dataDir = path.join(install, 'data')
    const before = snapshot(dataDir)

    const outcome = await updateInstallation(
      { packageRoot: download },
      {
        localAppData,
        // The one step a test can make fail deterministically on one volume: a
        // copy that writes part of the new tree and then dies (a full disk, a
        // read error, antivirus holding a file).
        copyTree: (_source, target) => {
          fs.mkdirSync(path.join(target, 'web', 'dist'), { recursive: true })
          fs.writeFileSync(path.join(target, 'server.js'), '// half a copy\n', 'utf8')
          throw new Error('磁盘已满')
        },
      },
    )

    expect(outcome).toMatchObject({ kind: 'refused', code: 'failed' })
    const message = outcome.kind === 'refused' ? outcome.message : ''
    expect(message).toContain('磁盘已满')
    expect(message).toContain('已经恢复')

    // The old program is the program again: the fallback was renamed back, not
    // copied, and the partial new tree is gone.
    expect(text(path.join(install, 'app', 'server.js'))).toContain('old')
    expect(text(path.join(install, 'app', 'node.exe'))).toContain('old')
    expect(fs.existsSync(path.join(install, 'app.old'))).toBe(false)
    expect(snapshot(dataDir)).toEqual(before)
  })

  it('keeps one generation of app.old\\ and never deletes anything else', async () => {
    const base = tempRoot('updater-generations-')
    const install = path.join(base, 'install')
    makeInstallation(install, '1.0.0', 'first')
    const localAppData = path.join(base, 'AppData')
    writeInstallPointer({ installRoot: install, localAppData })

    // A user's own folder beside the program: not the updater's to remove.
    fs.mkdirSync(path.join(install, '我的备份'), { recursive: true })
    fs.writeFileSync(path.join(install, '我的备份', 'keep.txt'), 'mine', 'utf8')
    const dataDir = path.join(install, 'data')
    const before = snapshot(dataDir)

    const second = path.join(base, 'download-1.0.1')
    makePackage(second, '1.0.1', 'second')
    expect(await updateInstallation({ packageRoot: second }, { localAppData })).toMatchObject({
      kind: 'updated',
      previousVersion: '1.0.0',
      installedVersion: '1.0.1',
    })

    const third = path.join(base, 'download-1.0.2')
    makePackage(third, '1.0.2', 'third')
    expect(await updateInstallation({ packageRoot: third }, { localAppData })).toMatchObject({
      kind: 'updated',
      previousVersion: '1.0.1',
      installedVersion: '1.0.2',
    })

    // Exactly one fallback, and it is the generation that was replaced last.
    const generations = fs
      .readdirSync(install)
      .filter(name => name === 'app' || name === 'app.old')
      .toSorted()
    expect(generations).toEqual(['app', 'app.old'])
    expect(text(path.join(install, 'app', 'server.js'))).toContain('third')
    expect(text(path.join(install, 'app.old', 'server.js'))).toContain('second')

    expect(text(path.join(install, '我的备份', 'keep.txt'))).toBe('mine')
    expect(snapshot(dataDir)).toEqual(before)
  })
})

describe('programTreePath', () => {
  it('names the two directories an update owns, and nothing else', () => {
    const install = path.resolve(path.join('Users', 'someone', '安装'))

    expect(programTreePath(install, 'app')).toBe(path.join(install, 'app'))
    expect(programTreePath(install, 'app.old')).toBe(path.join(install, 'app.old'))
  })

  it('refuses the data directory, escapes, absolute paths and unknown names', () => {
    const install = path.resolve(path.join('Users', 'someone', '安装'))

    for (const name of [
      'data',
      'data\\images',
      '..',
      'app\\..\\..\\data',
      'app.old\\..\\data',
      'APP',
      'app.old.backup',
      path.join(install, 'app'),
    ]) {
      expect(() => programTreePath(install, name)).toThrow(/may touch|inside/)
    }
  })
})
