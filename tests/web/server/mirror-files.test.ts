import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MIRROR_REFUSALS, resolveMirrorFile } from '../../../web/server/mirror-files.js'

const VALID = '1013_8dee54e8bf644722981751524fb54356.jpg'
const RETIRED = '978.竖版-2560x1440_61032b056992416faaf041b01d7c1633.jpg'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/**
 * A Mirror standing in for the real one, built as data: the query's names are
 * the names `readdirSync` returns, which is what the decisive check compares
 * against. The real `images/` is never read or written.
 */
function mirror(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-mirror-test-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, VALID), 'a')
  fs.writeFileSync(path.join(root, '.gallery-state.json'), '{}')
  fs.writeFileSync(path.join(root, 'notes.txt'), 'c')
  return root
}

/**
 * The resolved path, for the cases that must resolve; a refusal here is the
 * test failing, not a value to compare against.
 */
function resolvedPathOf(imagesDir: string, rawName: string): string {
  const resolution = resolveMirrorFile(imagesDir, rawName)
  if (!resolution.ok) throw new Error(`${rawName} was refused: ${resolution.reason}`)
  return resolution.path
}

describe('resolveMirrorFile', () => {
  it('resolves a name the Mirror listing contains, and only inside it', () => {
    const imagesDir = mirror()
    const expected = { ok: true, path: path.join(imagesDir, VALID) }

    expect(resolveMirrorFile(imagesDir, VALID)).toEqual(expected)
    // A percent-encoded real name is decoded exactly once, the way the URL
    // layer delivers it.
    expect(resolveMirrorFile(imagesDir, encodeURIComponent(VALID))).toEqual(expected)
  })

  it('refuses a name the listing does not contain, with the reason', () => {
    const imagesDir = mirror()

    expect(resolveMirrorFile(imagesDir, '999999_deadbeef.jpg')).toEqual({
      ok: false,
      reason: MIRROR_REFUSALS.notListed,
    })
    expect(resolveMirrorFile(imagesDir, 'notes.txt')).toEqual({
      ok: false,
      reason: MIRROR_REFUSALS.nonImage,
    })
  })

  it('refuses the case variant of a real file: the listing decides, not the filesystem', () => {
    const imagesDir = mirror()

    // The trap this test exists for: on Windows and macOS the filesystem is
    // case-insensitive, so `existsSync` would say the upper-cased name is there.
    // The exact-string Set lookup is the check that refuses it, and that
    // refusal is what holds on every platform — including
    // the CI runner's case-sensitive ext4, where no pre-assertion about
    // `existsSync` would even be true.
    expect(resolveMirrorFile(imagesDir, VALID.toUpperCase())).toEqual({
      ok: false,
      reason: MIRROR_REFUSALS.notListed,
    })
  })

  it.each([
    ['..', MIRROR_REFUSALS.dotSegment],
    ['.', MIRROR_REFUSALS.dotSegment],
    ['...', MIRROR_REFUSALS.dotfile],
    ['../package.json', MIRROR_REFUSALS.separator],
    ['..\\package.json', MIRROR_REFUSALS.separator],
    ['%2e%2e%2fpackage.json', MIRROR_REFUSALS.separator],
    ['%2e%2e%5Cpackage.json', MIRROR_REFUSALS.separator],
    ['%2e%2e%2f%2e%2e%2fpackage.json', MIRROR_REFUSALS.separator],
    ['....//....//config.ts', MIRROR_REFUSALS.separator],
    ['sub/1013_hash.jpg', MIRROR_REFUSALS.separator],
    ['/etc/passwd', MIRROR_REFUSALS.separator],
    ['C:\\Windows\\win.ini', MIRROR_REFUSALS.separator],
    ['C:/Windows/win.ini', MIRROR_REFUSALS.separator],
    ['\\\\server\\share\\evil.jpg', MIRROR_REFUSALS.separator],
    ['%00.jpg', MIRROR_REFUSALS.nul],
    ['bad%00name.jpg', MIRROR_REFUSALS.nul],
    ['C:evil.jpg', MIRROR_REFUSALS.colon],
    ['1013_hash.jpg:ads', MIRROR_REFUSALS.colon],
    ['.gallery-state.json', MIRROR_REFUSALS.dotfile],
    ['%2egallery-state.json', MIRROR_REFUSALS.dotfile],
    ['%', MIRROR_REFUSALS.malformedEncoding],
    ['%zz.jpg', MIRROR_REFUSALS.malformedEncoding],
    ['1013_hash.', MIRROR_REFUSALS.nonImage],
    [`${VALID} `, MIRROR_REFUSALS.nonImage],
    ['%252e%252e%252fpackage.json', MIRROR_REFUSALS.nonImage],
    ['1013_hash.jpg?x=1', MIRROR_REFUSALS.nonImage],
    ['1013_hash.jpg#x', MIRROR_REFUSALS.nonImage],
    ['', MIRROR_REFUSALS.empty],
    ['   ', MIRROR_REFUSALS.nonImage],
    ['CON.jpg', MIRROR_REFUSALS.notListed],
    ['NUL.jpg', MIRROR_REFUSALS.notListed],
    ['999999_deadbeef.jpg', MIRROR_REFUSALS.notListed],
  ])('refuses %j as %s', (name, reason) => {
    // Every case is a refusal and never a path — outside the Mirror is the one
    // outcome the contract forbids.
    expect(resolveMirrorFile(mirror(), name)).toEqual({ ok: false, reason })
  })

  it('never returns a path outside the Mirror directory', () => {
    const imagesDir = mirror()
    const outside = path.dirname(imagesDir)

    for (const name of ['..', '../package.json', '%2e%2e%2fpackage.json', 'C:\\evil.jpg']) {
      const result = resolveMirrorFile(imagesDir, name)
      expect(result.ok).toBe(false)
    }

    // The resolved path, when there is one, is a direct child of the Mirror.
    expect(resolvedPathOf(imagesDir, VALID)).toBe(path.join(imagesDir, VALID))
    expect(fs.existsSync(path.join(outside, 'package.json'))).toBe(false)
  })

  it('refuses a valid name when the Mirror is not there at all', () => {
    const missing = path.join(os.tmpdir(), 'console-mirror-absent-8f2c91')

    expect(resolveMirrorFile(missing, VALID)).toEqual({
      ok: false,
      reason: MIRROR_REFUSALS.notListed,
    })
  })

  it('refuses a directory that happens to carry an image name', () => {
    const imagesDir = mirror()
    fs.mkdirSync(path.join(imagesDir, '1014_abcdef.jpg'))

    expect(resolveMirrorFile(imagesDir, '1014_abcdef.jpg')).toEqual({
      ok: false,
      reason: MIRROR_REFUSALS.notAFile,
    })
  })

  it('keeps the retired Wallpaper readable: a name is a name', () => {
    const imagesDir = mirror()
    fs.writeFileSync(path.join(imagesDir, RETIRED), 'b')

    expect(resolveMirrorFile(imagesDir, RETIRED)).toEqual({
      ok: true,
      path: path.join(imagesDir, RETIRED),
    })
  })
})
