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
//   - an ADR file (`<NNNN>-<slug>.md`) with no line fails — a new decision
//     cannot pass by being unmentioned;
//   - a line naming a file that is not in the directory fails — a rename or a
//     deletion cannot leave a dead pointer behind.
//
// It also pins the shape the index promises: the lines ascend by number, each
// carries the number and the slug of the file it links, and the first line says
// the file is how a decision is found by its subject.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const ADR_DIR = path.resolve(import.meta.dirname, '..', '..', 'docs', 'adr')
const INDEX_FILE = path.join(ADR_DIR, 'README.md')

/** A decision file: `<NNNN>-<slug>.md`. Other files in the directory are not decisions. */
const ADR_FILE = /^(\d{4})-([a-z0-9-]+)\.md$/

/** One index line: `- [NNNN](NNNN-slug.md) `slug` — the clause it decides`. */
const INDEX_LINE = /^- \[(\d{4})\]\((\d{4})-([a-z0-9-]+)\.md\) `([a-z0-9-]+)` — (\S.*)$/

/** The decision files, in the directory's own ascending order. */
function adrFiles(): string[] {
  return fs
    .readdirSync(ADR_DIR)
    .filter(name => ADR_FILE.test(name))
    .toSorted()
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
})
