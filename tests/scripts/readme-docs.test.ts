// ── The one product document (#121) ─────────────────────────────────
//
// A player who unzips the release never opens this repository, so `README.md`
// is the one document they read — `scripts/package.ts` carries it at the archive
// root. The manual that used to sit there went with the launcher and the updater
// (#119), and `README.en.md` is the same document in English.
//
// This file pins what a reader acts on, not the prose:
//
//   - both documents are UTF-8 without a replacement character;
//   - both name the two commands, the Node floor and the data folder;
//   - the update is the same three steps, in a section of its own;
//   - the developer command set stays in `AGENTS.md`, not here;
//   - the licence agreement the package also carries (#89).

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const README_FILE = path.join(REPO_ROOT, 'README.md')
const README_EN_FILE = path.join(REPO_ROOT, 'README.en.md')
const LICENCE_FILE = path.join(REPO_ROOT, 'LICENSE')

/** The one Node floor: `package.json`'s `engines.node` without its `>=`. */
function repoNodeFloor(): string {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  if (typeof parsed === 'object' && parsed !== null && 'engines' in parsed) {
    const { engines } = parsed
    if (typeof engines === 'object' && engines !== null && 'node' in engines) {
      const { node } = engines
      if (typeof node === 'string' && /^>=\s*\d+\.\d+\.\d+$/.test(node.trim())) {
        return node.trim().replace(/^>=\s*/, '')
      }
    }
  }
  throw new Error('the repository package.json declares no >=X.Y.Z engines.node')
}

/** The floor the documents must name, read from the same manifest the floor lives in. */
const NODE_FLOOR = repoNodeFloor()

/** The documents, and their own names for the update section. */
const DOCUMENTS = [
  { name: 'README.md', file: README_FILE, updateHeading: '更新' },
  { name: 'README.en.md', file: README_EN_FILE, updateHeading: 'Updating' },
] as const

/** The lines under one `## ` heading, up to the next one. */
function section(markdown: string, heading: string): string {
  const marker = `## ${heading}`
  const start = markdown.indexOf(marker)
  if (start === -1) throw new Error(`the document has no "${marker}" section`)
  const rest = markdown.slice(start + marker.length)
  const end = rest.indexOf('\n## ')
  return end === -1 ? rest : rest.slice(0, end)
}

describe('the product document', () => {
  it('is UTF-8 without a replacement character', () => {
    for (const { name, file } of DOCUMENTS) {
      // The fatal decoder proves the bytes are UTF-8; the scan proves no earlier
      // edit left the decoder's replacement character behind.
      const text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file))
      expect(text, `${name} contains a replacement character`).not.toContain('\uFFFD')
    }
  })

  it('names the commands, the Node floor and the data folder', () => {
    for (const { name, file } of DOCUMENTS) {
      const text = fs.readFileSync(file, 'utf8')
      expect(text, `${name} does not name npm install`).toContain('npm install')
      expect(text, `${name} does not name npm start`).toContain('npm start')
      expect(text, `${name} does not state the Node floor`).toContain(NODE_FLOOR)
      expect(text, `${name} does not name the data folder`).toContain('data\\')
    }
  })

  it('documents the update as the same three steps', () => {
    // The three steps are the update: extract into a new folder, move `data\`
    // into it, delete the old folder only after the new one has run. The planner
    // and the reader share this shape, so the section is the assertion's subject.
    for (const { name, file, updateHeading } of DOCUMENTS) {
      const update = section(fs.readFileSync(file, 'utf8'), updateHeading)
      expect(update, `${name} does not name a new folder`).toMatch(/new folder|新文件夹/)
      expect(update, `${name} does not move data\\`).toContain('data\\')
      expect(update, `${name} does not delete the old folder`).toMatch(
        /delete the old folder|删除旧文件夹/,
      )
    }
  })

  it('leaves the developer command set to AGENTS.md', () => {
    // One document for players, one command table for developers (#121): the
    // README may point at AGENTS.md, but it may not become a second copy of it.
    for (const { name, file } of DOCUMENTS) {
      const text = fs.readFileSync(file, 'utf8')
      for (const command of ['pnpm lint', 'pnpm typecheck', 'pnpm test', 'pnpm build']) {
        expect(text, `${name} teaches the developer command ${command}`).not.toContain(command)
      }
      expect(text, `${name} does not point at AGENTS.md`).toContain('AGENTS.md')
    }
  })
})

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
