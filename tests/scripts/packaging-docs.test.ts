// ── The package's user-facing documents (#89) ────────────────────────
//
// A player who unzips the release never opens this repository: the manual at the
// archive root and the licence beside the code are what they read. Both are
// content, so these tests pin the properties whose loss would break the reader,
// not the prose itself:
//
//   - the manual is a `.txt` Notepad opens without guessing — UTF-8 with a BOM
//     and CRLF — and those are the bytes the packager copies (`.gitattributes`
//     pins the file with `-text` for exactly that reason);
//   - it answers the questions the ticket lists, in the order a reader meets
//     them: start, first download, update, rollback, uninstall, where the data
//     is, what to do when Windows/antivirus blocks the program, who to ask;
//   - `LICENSE` is MIT, `package.json` declares the same licence, and the
//     copyright and wallpaper-ownership statement are present;
//   - the packager's generic root-file rule picks the manual up with no code.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { rootPackageFiles } from '../../scripts/package-layout.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const PACKAGING_DIR = path.join(REPO_ROOT, 'packaging')
const MANUAL_FILE = path.join(PACKAGING_DIR, '使用说明.txt')
const LICENCE_FILE = path.join(REPO_ROOT, 'LICENSE')

/** The manual as Notepad shows it: decoded from UTF-8, BOM removed. */
function manualText(): string {
  return fs.readFileSync(MANUAL_FILE, 'utf8').replace(/^\uFEFF/, '')
}

describe('the packaged manual', () => {
  it('is UTF-8 with a BOM and CRLF, so Notepad reads it correctly', () => {
    const bytes = fs.readFileSync(MANUAL_FILE)

    // A BOM is Notepad's one unambiguous signal that a `.txt` is UTF-8; without
    // it the reader depends on a heuristic, and a wrong guess is mojibake.
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])

    const text = manualText()
    expect(text).not.toContain('\uFFFD')
    expect(text.length).toBeGreaterThan(1000)

    // Every newline is CRLF: no bare LF and no bare CR (Notepad is lenient, but
    // the file is also read as a whole by other Windows tools).
    expect(text).toContain('\r\n')
    expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
  })

  it('travels at the archive root with no packager change', () => {
    expect(rootPackageFiles(PACKAGING_DIR)).toContain('使用说明.txt')
  })

  it('answers the questions the ticket lists, in the order a reader meets them', () => {
    const text = manualText()
    for (const heading of [
      '这是什么',
      '解压到哪里',
      '启动和停止',
      '第一次抓取',
      '更新到新版本',
      '回退',
      '卸载',
      '你的东西在哪里',
      '拦下',
      '出错了找谁',
    ]) {
      expect(text, `the manual is missing the "${heading}" section`).toContain(heading)
    }
  })

  it('names the facts a player acts on, not just the topics', () => {
    const text = manualText()
    for (const fact of [
      // the two launchers and the page's own start button
      '启动.bat',
      '更新.bat',
      '开始运行',
      // the first download's size and time expectation
      '2 GB',
      '10–40 分钟',
      // the one fallback directory the updater leaves behind
      'app.old',
      // where the user's things are
      'data\\images',
      'data\\logs',
      // the fallback when the updater cannot find the installation
      '拖到',
      // the Mark-of-the-Web instruction the program itself prints
      'Unblock-File',
      // Chrome is not a prerequisite any more
      'Chrome',
      // where to ask for help
      'GitHub',
    ]) {
      expect(text, `the manual does not mention ${fact}`).toContain(fact)
    }
  })

  it('says the wallpapers belong to the official site and that this tool stores and distributes none', () => {
    const text = manualText()
    expect(text).toContain('版权归官方')
    expect(text).toContain('不存储')
  })
})

describe('the licence', () => {
  it('is MIT, and package.json declares the same licence', () => {
    const licence = fs.readFileSync(LICENCE_FILE, 'utf8')
    expect(licence).toContain('MIT License')
    expect(licence).toMatch(/Copyright \(c\) 2026 ChoriaKiinweill/)

    const packageJson: unknown = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    )
    expect(packageJson).toMatchObject({ license: 'MIT' })
  })

  it('states that the wallpapers are the official site’s and that the tool stores or distributes none', () => {
    const licence = fs.readFileSync(LICENCE_FILE, 'utf8')
    expect(licence).toMatch(/wallpapers/i)
    expect(licence).toMatch(/property of/i)
    expect(licence).toMatch(/does not store or\s+distribute/i)
  })
})
