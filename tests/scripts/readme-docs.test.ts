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
//   - the two variants are one document: the same heading levels, position by
//     position (#137);
//   - the repository's command set stays in the steering file, not here;
//   - the licence agreement the package also carries (#89).
//
// The style guide (#125) adds three points to the same contract: a status line
// naming the manifest's version, a link to the issue tracker, and none of the
// retired vocabulary. Each document entry turns them on for its own variant, so
// the English document adopts them without an assertion changing (#126, #127).
//
// The guide's landing rule — a change to one variant is a change to both — is
// the mirror assertion (#137). It compares the two documents' heading levels
// and nothing else: two languages share no prose to compare, and a translation
// table would be a second copy of both documents to keep in step.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const README_FILE = path.join(REPO_ROOT, 'README.md')
const README_EN_FILE = path.join(REPO_ROOT, 'README.en.md')
const LICENCE_FILE = path.join(REPO_ROOT, 'LICENSE')
/** The guide is the retired vocabulary's only home; this contract reads it as data. */
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
 * The retired vocabulary of the style guide, read from its `## Retired
 * vocabulary` rule: the guide is the list's only home, so a word added there is
 * enforced here without a second edit.
 *
 * A token that is all Han script is Chinese; every other token is English,
 * matched as a whole word. `user` is deliberately absent from the guide's list:
 * `data\user.env` is a path the document must keep naming, so retiring it would
 * put the document and its contract in conflict.
 */
function retiredWordsFromGuide(): { zh: readonly string[]; en: readonly string[] } {
  const rule = section(fs.readFileSync(STYLEGUIDE_FILE, 'utf8'), 'Retired vocabulary')
  const tokens = [...rule.matchAll(/`([^`]+)`/g)]
    .map(match => match[1].trim())
    .filter(token => token !== '')
  const zh = tokens.filter(token => /^\p{Script=Han}+$/u.test(token))
  const en = tokens.filter(token => !/^\p{Script=Han}+$/u.test(token))
  // An empty list would pass every document without checking one word, so it
  // fails here instead of silently enforcing nothing.
  if (zh.length === 0) throw new Error('the style guide retires no Chinese words')
  if (en.length === 0) throw new Error('the style guide retires no English words')
  return { zh, en }
}

const RETIRED_WORDS = retiredWordsFromGuide()

/**
 * One product document and the guide's points its variant carries. Every field
 * is required, so dropping one is a typecheck error rather than a silently
 * disabled assertion. No assertion reads a document name, so both variants run
 * the same checks.
 */
type DocumentEntry = {
  name: string
  file: string
  updateHeading: string
  /** The status line's opening text; the same line names `VERSION`. */
  statusLabel: string
  /** The issue tracker the document links. */
  issueTracker: string
  /** The retired words of the document's language. */
  retiredWords: readonly string[]
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

/**
 * One document's heading structure: the level of each ATX heading, in order.
 * The heading text is deliberately dropped, because two languages share no
 * prose to compare (#137). A fenced block is skipped, so a `#` line inside a
 * shell snippet is not read as a heading.
 */
function headingLevels(markdown: string): readonly number[] {
  const levels: number[] = []
  let fenced = false
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const heading = /^(#{1,6})\s+\S/.exec(line)
    if (heading) levels.push(heading[1].length)
  }
  return levels
}

/** One side of a differing position, worded for the failure message. */
function headingAt(levels: readonly number[], index: number): string {
  const level = levels[index]
  return level === undefined ? 'no heading' : `a level-${level} heading`
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
      const text = fs.readFileSync(file, 'utf8')
      for (const word of retiredWords) {
        const pattern = /^\p{Script=Han}+$/u.test(word)
          ? new RegExp(word, 'u')
          : new RegExp(`\\b${word}\\b`, 'iu')
        expect(text, `${name} uses the retired word "${word}"`).not.toMatch(pattern)
      }
    }
  })

  it('leaves the repository command set to the steering file', () => {
    // One document for the product, one command table in the steering file
    // (#121): the README may point at `AGENTS.md`, but it may not become a
    // second copy of it.
    for (const { name, file } of DOCUMENTS) {
      const text = fs.readFileSync(file, 'utf8')
      for (const command of ['pnpm lint', 'pnpm typecheck', 'pnpm test', 'pnpm build']) {
        expect(text, `${name} teaches the repository command ${command}`).not.toContain(command)
      }
      expect(text, `${name} does not point at AGENTS.md`).toContain('AGENTS.md')
    }
  })

  it('keeps one heading structure in both variants, position by position', () => {
    // The style guide's landing rule: a change to one variant is a change to
    // both, so the two documents must carry the same sections in the same order
    // (#137). The comparison is the sequence of levels only — a gain, a loss or
    // a reorder that moves a heading across a level boundary shows up as a
    // position that differs. Two sibling headings of one level are
    // interchangeable in a structure-only reading; telling them apart would mean
    // reading the prose. The first entry is the reference the others meet.
    const [reference, ...variants] = DOCUMENTS
    const referenceLevels = headingLevels(fs.readFileSync(reference.file, 'utf8'))
    for (const variant of variants) {
      const levels = headingLevels(fs.readFileSync(variant.file, 'utf8'))
      // Walk the longer sequence, so a heading gained or lost at the end is
      // still reached and named rather than silently passing.
      const positions = Math.max(referenceLevels.length, levels.length)
      for (let index = 0; index < positions; index += 1) {
        expect(
          levels[index],
          `${variant.name} differs from ${reference.name} at heading position ${index + 1} of ${positions}: ${reference.name} has ${headingAt(referenceLevels, index)}, ${variant.name} has ${headingAt(levels, index)}`,
        ).toBe(referenceLevels[index])
      }
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
