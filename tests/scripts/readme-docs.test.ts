// ── The one product document (#121) ─────────────────────────────────
//
// A reader who unzips the release never opens this repository, so `README.md`
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
//
// The style guide (#125) adds three points to the same contract: a status line
// naming the manifest's version, a link to the issue tracker, and none of the
// retired vocabulary. Each document entry turns them on for its own variant, so
// the English document adopts them without an assertion changing (#126, #127).

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const README_FILE = path.join(REPO_ROOT, 'README.md')
const README_EN_FILE = path.join(REPO_ROOT, 'README.en.md')
const LICENCE_FILE = path.join(REPO_ROOT, 'LICENSE')
const AGENTS_FILE = path.join(REPO_ROOT, 'AGENTS.md')
const STYLEGUIDE_FILE = path.join(REPO_ROOT, 'docs', 'readme-styleguide.md')

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

/** The release the status line must name, read from the manifest a release is cut from. */
function repoVersion(): string {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
    const { version } = parsed
    if (typeof version === 'string' && /^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(version.trim())) {
      return version.trim()
    }
  }
  throw new Error('the repository package.json declares no X.Y.Z version')
}

/** The status line's version: the manifest's, never a literal repeated here. */
const VERSION = repoVersion()

/** The repository's issue tracker, the document's "where to ask" point (#126). */
const ISSUE_TRACKER = 'https://github.com/makursi/re1999-wallpaper-crawler/issues'

/**
 * The retired vocabulary of the style guide, per language, as whole words.
 *
 * `user` is deliberately absent: `data\user.env` is a path the document must
 * keep naming, so retiring it would put the document and its contract in
 * conflict. Chinese has no boundaries to anchor, so its words match as written.
 */
const RETIRED_WORDS = {
  zh: ['玩家', '使用者', '开发者'],
  en: ['player', 'players', 'developer', 'developers'],
} as const

/**
 * One product document and the guide's points its variant has adopted. The last
 * three fields are turned on by filling them in — no assertion reads a document
 * name — so the English variant adopts them without rewriting an assertion.
 */
type DocumentEntry = {
  name: string
  file: string
  updateHeading: string
  /** The status line's opening text; the same line names `VERSION`. */
  statusLabel?: string
  /** The issue tracker the document links. */
  issueTracker?: string
  /** The retired words of the document's language. */
  retiredWords?: readonly string[]
}

/** The documents, their own names for the update section, and the points they carry. */
const DOCUMENTS: readonly DocumentEntry[] = [
  {
    name: 'README.md',
    file: README_FILE,
    updateHeading: '更新',
    statusLabel: '当前版本',
    issueTracker: ISSUE_TRACKER,
    retiredWords: RETIRED_WORDS.zh,
  },
  // The English variant carries its own names for the same three guide points
  // (#127): the label its status line starts with, the same tracker, and the
  // retired words of English.
  {
    name: 'README.en.md',
    file: README_EN_FILE,
    updateHeading: 'Updating',
    statusLabel: 'Current version',
    issueTracker: ISSUE_TRACKER,
    retiredWords: RETIRED_WORDS.en,
  },
]

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

  it('names the release the manifest declares', () => {
    // The status line is the document's status point (#126). Its version comes
    // from `package.json`, so a forgotten bump fails here instead of shipping a
    // document that describes an older release than the archive beside it.
    for (const { name, file, statusLabel } of DOCUMENTS) {
      if (statusLabel === undefined) continue
      const statusLine = fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .find(line => line.startsWith(statusLabel))
      expect(statusLine, `${name} has no "${statusLabel}" status line`).toBeDefined()
      // The backticks make the version whole: only the full version satisfies
      // the assertion, never a fragment of a larger number.
      expect(statusLine, `${name}'s status line does not name \`${VERSION}\``).toContain(
        `\`${VERSION}\``,
      )
    }
  })

  it('links the issue tracker', () => {
    // "Where to ask" is one of the guide's five points (#126): the reader must
    // reach the repository's tracker from the document, not guess the address.
    for (const { name, file, issueTracker } of DOCUMENTS) {
      if (issueTracker === undefined) continue
      expect(fs.readFileSync(file, 'utf8'), `${name} does not link ${issueTracker}`).toContain(
        issueTracker,
      )
    }
  })

  it('uses none of the retired vocabulary in its language', () => {
    // The document names the product and its operations, never a population
    // (#126). English words are matched whole and case-insensitively, so a
    // heading such as "Developers" fails; `data\user.env` survives because
    // `user` is not on the list.
    for (const { name, file, retiredWords } of DOCUMENTS) {
      if (retiredWords === undefined) continue
      const text = fs.readFileSync(file, 'utf8')
      for (const word of retiredWords) {
        const pattern = /^\p{Script=Han}+$/u.test(word)
          ? new RegExp(word, 'u')
          : new RegExp(`\\b${word}\\b`, 'iu')
        expect(text, `${name} uses the retired word "${word}"`).not.toMatch(pattern)
      }
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

describe('the README style guide', () => {
  it('is committed, and the steering document points at it', () => {
    // A guide nothing links is a guide the next edit never reads. The steering
    // document is the first file a session opens, so the pointer lives there;
    // the path is the assertion, and the existence check is the other half of
    // the pointer: a link to nothing would pass a text-only assertion.
    const agents = fs.readFileSync(AGENTS_FILE, 'utf8')
    expect(agents, 'AGENTS.md does not point at docs/readme-styleguide.md').toContain(
      'docs/readme-styleguide.md',
    )
    expect(fs.existsSync(STYLEGUIDE_FILE), 'docs/readme-styleguide.md does not exist').toBe(true)
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
