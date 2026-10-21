// ── Where this program is installed (#85) ───────────────────────────
//
// The updater (#87) has to find the extraction the user is actually running,
// which is not "wherever the last zip was unzipped to": the folder can be
// renamed or moved after installation. So every start records the installation
// root in a pointer file under `%LOCALAPPDATA%`, and the updater reads that.
//
// Only the portable package has an installation to point at — `<install>\app`
// beside `<install>\data`. A source checkout has neither shape, so the pointer
// is left alone there, which is also what keeps `pnpm webui` out of the user's
// AppData.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  INSTALL_POINTER_DIR_NAME,
  INSTALL_POINTER_FILE_NAME,
  installPointerFile,
  installRootOf,
  readInstallPointer,
  writeInstallPointer,
} from '../../../web/server/installation.js'

const roots: string[] = []

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('installRootOf', () => {
  it('names the extraction root of app beside data: <install>', () => {
    const install = path.join(tempRoot('console-install-'), '壁纸 程序')
    const appRoot = path.join(install, 'app')
    const dataRoot = path.join(install, 'data')

    expect(installRootOf(appRoot, dataRoot)).toBe(path.resolve(install))
  })

  it('is null for a source checkout, whose data is the app root child', () => {
    const repo = tempRoot('console-install-')

    // `pnpm webui` must not write an installation pointer into AppData: there
    // is no `<install>\app` here, only the repository.
    expect(installRootOf(repo, path.join(repo, 'data'))).toBeNull()
  })

  it('is null when the data directory is not the app directory sibling', () => {
    const install = tempRoot('console-install-')

    expect(installRootOf(path.join(install, 'app'), path.join(install, 'other'))).toBeNull()
    expect(installRootOf(path.join(install, 'app'), tempRoot('console-install-'))).toBeNull()
  })

  it('is null when the program directory is not the package app directory', () => {
    const install = tempRoot('console-install-')

    // The package's shape is fixed: `<install>\app`, not any sibling name.
    expect(installRootOf(path.join(install, 'program'), path.join(install, 'data'))).toBeNull()
  })
})

describe('installPointerFile', () => {
  it('is one file inside an app-named directory under LOCALAPPDATA', () => {
    const localAppData = path.join('C:\\', 'Users', 'someone', 'AppData', 'Local')

    expect(installPointerFile(localAppData)).toBe(
      path.join(localAppData, INSTALL_POINTER_DIR_NAME, INSTALL_POINTER_FILE_NAME),
    )
    expect(INSTALL_POINTER_DIR_NAME).toBe('re1999-wallpaper-crawler')
    expect(INSTALL_POINTER_FILE_NAME).toBe('install.json')
  })

  it('is null without LOCALAPPDATA, so nothing is written off Windows', () => {
    expect(installPointerFile(undefined)).toBeNull()
    expect(installPointerFile('   ')).toBeNull()
  })
})

describe('writeInstallPointer', () => {
  it('creates the pointer directory and records the installation root', () => {
    const localAppData = tempRoot('console-pointer-')
    const install = path.join(localAppData, 'Install Folder')

    const result = writeInstallPointer({
      installRoot: install,
      localAppData,
      now: new Date('2026-10-21T12:00:00.000Z'),
    })

    const file = installPointerFile(localAppData)
    expect(result).toEqual({ written: true, file })
    expect(readInstallPointer(file ?? '')).toMatchObject({
      kind: 'pointer',
      pointer: {
        version: 1,
        installRoot: path.resolve(install),
        updatedAt: '2026-10-21T12:00:00.000Z',
      },
    })
  })

  it('writes nothing when the machine has no LOCALAPPDATA', () => {
    expect(
      writeInstallPointer({ installRoot: tempRoot('console-install-'), localAppData: '' }),
    ).toEqual({ written: false, reason: 'no-local-app-data' })
  })

  it('reports an unwritable location instead of throwing', () => {
    const base = tempRoot('console-pointer-')
    // A file where the pointer directory would go: mkdir cannot succeed.
    const localAppData = path.join(base, 'blocked')
    fs.writeFileSync(localAppData, 'not a directory', 'utf8')

    expect(writeInstallPointer({ installRoot: base, localAppData })).toEqual({
      written: false,
      reason: 'unwritable',
    })
  })
})
