// ── The ADR index resolves a number to its decision (#109) ───────────
//
// `docs/adr/` is where a decision lands. A number cannot say what its decision
// is, so the directory carries a hand-written index: one line per decision with
// the number, the slug and the clause it decides. That index is a lookup by
// subject, not a second copy of the ADRs, and the only thing that keeps it
// true is this test reading the real directory as data.
//
// The comparison runs in both directions, which is what the two failures are:
//
//   - a decision file (`<NNNN>-<slug>.md`) with no line fails — a new decision
//     cannot pass by being unmentioned;
//   - a line naming a file that is not in the directory fails — a rename or a
//     deletion cannot leave a dead pointer behind.
//
// A third check closes the reader's blind spot. The decision-file pattern only
// recognises one name shape, so a file it cannot read — `drafts/0024-x.md`,
// `0024_X.md` — would otherwise sit in the directory unmentioned while this
// test stayed green. Every Markdown file under `docs/adr/` other than this
// index is therefore either a decision file or named in `EXEMPT_ADR_PATHS`;
// the list is deliberately empty today, and a drafts directory is the legitimate
// reason it exists.
//
// It also pins the shape the index promises: the lines ascend by number, each
// carries the number and the slug of the file it links, and the first line says
// the file is how a decision is found by its subject.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const ADR_DIR = path.resolve(import.meta.dirname, '..', '..', 'docs', 'adr')
const INDEX_FILE = path.join(ADR_DIR, 'README.md')

/** The index's own name: the one Markdown file here that is not a subject. */
const INDEX_NAME = path.basename(INDEX_FILE)

/** A decision file: `<NNNN>-<slug>.md`. Other names are not decisions. */
const ADR_FILE = /^(\d{4})-([a-z0-9-]+)\.md$/

/** One index line: `- [NNNN](NNNN-slug.md) `slug` — the clause it decides`. */
const INDEX_LINE = /^- \[(\d{4})\]\((\d{4})-([a-z0-9-]+)\.md\) `([a-z0-9-]+)` — (\S.*)$/

/**
 * Markdown the directory may hold without a line in the index. Entries are
 * paths relative to `docs/adr/`, `/`-separated, and a trailing `/` exempts a
 * whole directory: `drafts/` is the legitimate case, because a decision still
 * being written is not one to look up yet. Empty today — every Markdown file
 * is a decision — and naming an exemption here is what makes it deliberate and
 * visible instead of a filename this reader happens to skip.
 */
const EXEMPT_ADR_PATHS: readonly string[] = []

/** Whether a relative path is covered by one of `exemptions`. */
function exempted(file: string, exemptions: readonly string[] = EXEMPT_ADR_PATHS): boolean {
  return exemptions.some(entry => (entry.endsWith('/') ? file.startsWith(entry) : file === entry))
}

/** Every `.md` under `docs/adr/`, relative to it, `/`-separated and ascending. */
function markdownFiles(directory: string = ADR_DIR): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...markdownFiles(absolute))
    else if (entry.name.endsWith('.md')) {
      files.push(path.relative(ADR_DIR, absolute).split(path.sep).join('/'))
    }
  }
  return files.toSorted()
}

/** The decision files, in the directory's own ascending order. */
function adrFiles(): string[] {
  return markdownFiles().filter(name => ADR_FILE.test(name))
}

/** The index's non-empty lines; its first line is the claim, the rest are decisions. */
function indexLines(): string[] {
  return fs
    .readFileSync(INDEX_FILE, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
}

interface DecisionLine {
  number: string
  file: string
  fileSlug: string
  slug: string
  clause: string
}

/** Parse the decision lines, rejecting any line that is not the one-line shape. */
function decisionLines(): DecisionLine[] {
  return indexLines()
    .slice(1)
    .map(line => {
      const match = INDEX_LINE.exec(line)
      if (match == null) throw new Error(`the index line is not the one-line shape: ${line}`)
      const [, number, fileNumber, fileSlug, slug, clause] = match
      return { number, file: `${fileNumber}-${fileSlug}.md`, fileSlug, slug, clause }
    })
}

describe('the ADR index', () => {
  it('opens by saying it is how a decision is found by subject', () => {
    expect(indexLines()[0]).toMatch(/^# .*decision.*subject/i)
  })

  it('lists every decision file, in ascending order, exactly once', () => {
    const files = adrFiles()
    // A duplicate is a second line for one decision, which would also break the
    // file comparison below by leaving another file unmentioned.
    expect(new Set(files).size).toBe(files.length)

    const decisions = decisionLines()
    expect(decisions.map(line => line.file)).toEqual(files)
    expect(decisions.map(line => line.number)).toEqual(
      decisions.map(line => line.number).toSorted(),
    )
  })

  it('accounts for every Markdown file under docs/adr/, so an unrecognised name cannot hide', () => {
    // The reader above recognises only `<NNNN>-<slug>.md`. This check is what
    // makes that narrowness safe: a file it cannot read has to be named here or
    // in the exemption list, and the failure names the file.
    const unaccounted = markdownFiles().filter(
      file => file !== INDEX_NAME && !ADR_FILE.test(file) && !exempted(file),
    )
    expect(
      unaccounted,
      `docs/adr/ holds ${unaccounted.join(', ')}, which the index does not mention and
EXEMPT_ADR_PATHS does not name. Add a line to docs/adr/README.md, or name the path in
EXEMPT_ADR_PATHS with the reason it is not a decision.`,
    ).toEqual([])
  })

  it('names a file that exists, so no line points at a decision that is gone', () => {
    for (const line of decisionLines()) {
      expect(
        fs.existsSync(path.join(ADR_DIR, line.file)),
        `the index names ${line.file}, which is not in docs/adr/`,
      ).toBe(true)
    }
  })

  it('carries the number, the slug and a one-clause decision on every line', () => {
    for (const line of decisionLines()) {
      expect(line.number, `${line.file} is indexed under another number`).toBe(
        line.file.slice(0, 4),
      )
      expect(line.slug, `${line.file} is indexed under another slug`).toBe(line.fileSlug)
      // The clause is the decision in one line; the regex above already
      // rejected an empty one, and no body is copied because the line ends here.
      expect(line.clause.length).toBeGreaterThan(0)
    }
  })

  it('keeps every exemption real, so a stale entry is not a permanent silence', () => {
    for (const entry of EXEMPT_ADR_PATHS) {
      expect(
        fs.existsSync(path.join(ADR_DIR, entry)),
        `EXEMPT_ADR_PATHS names ${entry}, which is not in docs/adr/`,
      ).toBe(true)
    }
  })
})

describe('the exemption rule', () => {
  it('matches a file exactly, and a whole directory by its trailing slash', () => {
    expect(exempted('drafts/0024-x.md', ['drafts/'])).toBe(true)
    expect(exempted('0024_X.md', ['0024_X.md'])).toBe(true)
    expect(exempted('drafts/0024-x.md', ['0024_X.md'])).toBe(false)
    expect(exempted('0024-x.md', [])).toBe(false)
  })
})
