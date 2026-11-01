// ── The package's licence (#89) ──────────────────────────────────────
//
// A player who unzips the release never opens this repository, so the licence
// beside the code is what they read. The manual that used to sit at the archive
// root went with the launcher and the updater (#119); `README.md` is the one
// document now, and this file keeps the licence's pins:
//
//   - `LICENSE` is MIT, `package.json` declares the same licence, and the
//     copyright and wallpaper-ownership statement are present.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const LICENCE_FILE = path.join(REPO_ROOT, 'LICENSE')

describe('the licence', () => {
  it('is MIT, and package.json declares the same licence', () => {
    const licence = fs.readFileSync(LICENCE_FILE, 'utf8')
    expect(licence).toContain('MIT License')
    // The holder is the maintainer's to choose and may change; what must not
    // change is that a year and a name are actually there. Pinning the name
    // here would make renaming the copyright a test failure.
    expect(licence).toMatch(/Copyright \(c\) \d{4} \S/)

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
