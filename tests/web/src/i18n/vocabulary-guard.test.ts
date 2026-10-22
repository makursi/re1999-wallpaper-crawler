// ── The contract's vocabularies, and who answers for them (#112) ─────
//
// `web/api-types.ts` exports its code vocabularies as `const` tuples so the
// dictionary test can enumerate them and prove every code has copy in both
// locales (#47). That loop is exhaustive only over the tuples someone listed by
// hand: the dictionary test names three, so a fourth tuple — a vocabulary the
// page stopped speaking but the contract kept — sits outside every gate. In the
// iteration behind spec #107 one did, and a reviewer found it.
//
// This file closes the loop from the contract's side. It reads the contract
// module as source, so the vocabularies it checks are the module's own rather
// than a second hand-maintained list that could drift the way the first one did:
// every exported runtime tuple it finds must be either enumerated by
// `tests/web/src/i18n/messages.test.ts` or named in `EXEMPT_VOCABULARIES` with
// the one line that says why it has no copy. Retiring a vocabulary therefore
// stays two deliberate edits — the copy goes, and either the tuple goes or the
// exemption records it.
//
// Both readers below blank comments and the insides of strings before looking
// for the code's shape, so a reformat (one line or many), a doc comment or a
// commented-out declaration changes nothing about what is found — and a line of
// prose that happens to spell a tuple cannot stand in for the tuple.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const CONTRACT_FILE = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'web',
  'api-types.ts',
)
const DICTIONARY_TEST_FILE = path.join(import.meta.dirname, 'messages.test.ts')

/** One vocabulary the contract keeps but the page's dictionary does not answer for. */
interface ExemptVocabulary {
  /** The tuple's exported name, exactly as `web/api-types.ts` writes it. */
  readonly name: string
  /** Why there is no copy for it — one line, so the list stays readable. */
  readonly reason: string
}

/**
 * Vocabularies the contract exports that the page has no words for. Empty
 * today: all three tuples are enumerated by the dictionary test.
 *
 * A vocabulary retired from the page's copy while it stays in the contract is
 * added here with its reason, so the retirement is recorded rather than
 * inferred from silence. An entry is not a way to silence the check: it has to
 * name a tuple the contract really exports, it has to carry a written reason,
 * and a vocabulary the dictionary still answers for may not be listed.
 */
const EXEMPT_VOCABULARIES: readonly ExemptVocabulary[] = []

/**
 * The source with its comments and the insides of its strings blanked —
 * newlines kept, so line numbers and line structure survive. What remains is
 * the code's shape: a declaration written in a comment, or the same words
 * inside a message, must not count as code.
 */
function codeOnly(source: string): string {
  const code = source.split('')
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i += 1) {
      if (code[i] !== '\n') code[i] = ' '
    }
  }
  let i = 0
  while (i < source.length) {
    const char = source[i]
    if (char === '/' && source[i + 1] === '/') {
      const lineEnd = source.indexOf('\n', i)
      const end = lineEnd === -1 ? source.length : lineEnd
      blank(i, end)
      i = end
    } else if (char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2)
      const end = close === -1 ? source.length : close + 2
      blank(i, end)
      i = end
    } else if (char === "'" || char === '"' || char === '`') {
      let end = i + 1
      while (end < source.length) {
        if (source[end] === '\\') end += 2
        else if (source[end] === char) break
        else end += 1
      }
      blank(i + 1, Math.min(end, source.length))
      i = end + 1
    } else {
      i += 1
    }
  }
  return code.join('')
}

/** The index of the `]` closing the `[` at `open`; `-1` when the source ends first. */
function closingBracket(code: string, open: number): number {
  let depth = 0
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '[') depth += 1
    else if (code[i] === ']') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

const TUPLE_DECLARATION = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g

/**
 * Every exported runtime tuple literal in a source file: `export const NAME = [ ... ] as const`,
 * however it is laid out. The `as const` is the anchor — a mutable array is not the vocabulary form
 * this contract uses, and a type-only export has no runtime shape to enumerate.
 */
function exportedTupleNames(source: string): string[] {
  const code = codeOnly(source)
  const names: string[] = []
  for (const match of code.matchAll(TUPLE_DECLARATION)) {
    const open = (match.index ?? 0) + match[0].length - 1
    const close = closingBracket(code, open)
    if (close === -1) continue
    if (/^\s*as\s+const\b/.test(code.slice(close + 1))) names.push(match[1])
  }
  return names
}

const ENUMERATION = /\.\.\.\s*([A-Za-z_$][\w$]*)\s*\.\s*map\s*\(/g

/**
 * The vocabularies the dictionary test enumerates: it spreads `NAME.map(...)`
 * into its `codeKeys` list, and that spread is the enumeration this guard reads.
 */
function enumeratedTupleNames(source: string): string[] {
  return [...codeOnly(source).matchAll(ENUMERATION)].map(match => match[1])
}

describe('the contract reader', () => {
  it('finds the tuple form through comments, trailing comments and any layout', () => {
    // The same contract in miniature: a doc comment above, one tuple on many
    // lines with a trailing comment, one on a single line, and decoys — a
    // commented-out tuple, a mutable array, and the words inside a string.
    const source = [
      '/** Why a Run was refused. */',
      'export const REFUSAL_CODES = [',
      "  'run-busy', // the next start would collide",
      "  'orphaned-run',",
      '] as const',
      '',
      "export const PREREQUISITE_CODES = ['env-file'] as const",
      '',
      "// export const COMMENTED_OUT = ['nope'] as const",
      "/* export const BLOCK_COMMENTED = ['nope'] as const */",
      "export const NOT_A_TUPLE = ['mutable']",
      "export const DESCRIBES_ITSELF = 'export const PROSE = [] as const'",
    ].join('\n')

    expect(exportedTupleNames(source)).toEqual(['REFUSAL_CODES', 'PREREQUISITE_CODES'])
  })

  it('finds the dictionary test’s enumeration, not a mention of a tuple', () => {
    const source = [
      "import { FORGOTTEN_CODES, REFUSAL_CODES } from '../../../../web/api-types.js'",
      '',
      '// The dictionary test enumerates only one of the two it imports, below.',
      'const codeKeys: [string, string][] = [',
      '  ...REFUSAL_CODES.map(code => [code, REFUSAL_MESSAGE_KEYS[code]]),',
      ']',
    ].join('\n')

    expect(enumeratedTupleNames(source)).toEqual(['REFUSAL_CODES'])
  })
})

describe('every runtime vocabulary the contract exports', () => {
  const tupleNames = exportedTupleNames(fs.readFileSync(CONTRACT_FILE, 'utf8'))
  const enumeratedNames = enumeratedTupleNames(fs.readFileSync(DICTIONARY_TEST_FILE, 'utf8'))
  const exemptNames = EXEMPT_VOCABULARIES.map(entry => entry.name)

  it('is found, not assumed — the reader sees the contract and the dictionary test', () => {
    // A reader that silently stopped matching would make every rule below pass
    // over an empty list, so the guard states that it read something first.
    expect(tupleNames.length, 'web/api-types.ts exports no runtime tuple literal').toBeGreaterThan(
      0,
    )
    expect(
      enumeratedNames.length,
      'tests/web/src/i18n/messages.test.ts enumerates no contract tuple',
    ).toBeGreaterThan(0)
  })

  it('is enumerated by the dictionary test or named in the exemption list', () => {
    const unaccounted = tupleNames.filter(
      name => !enumeratedNames.includes(name) && !exemptNames.includes(name),
    )
    expect(
      unaccounted,
      `web/api-types.ts exports ${unaccounted.join(', ')}, which no dictionary copy answers
for. Enumerate each in tests/web/src/i18n/messages.test.ts (spread \`...${unaccounted[0]}.map(...)\`
into \`codeKeys\`), or record the retirement in EXEMPT_VOCABULARIES with its one-line reason.`,
    ).toEqual([])
  })

  it('is not enumerated by the dictionary test after the contract dropped it', () => {
    // The other direction: a tuple the dictionary test still enumerates has to
    // be a tuple the contract still exports. This is also what stops the reader
    // above from passing vacuously — the enumeration names the tuples it reads.
    const unexported = enumeratedNames.filter(name => !tupleNames.includes(name))
    expect(
      unexported,
      `tests/web/src/i18n/messages.test.ts enumerates ${unexported.join(', ')}, but
web/api-types.ts exports no such tuple — the tuple was renamed or removed, and the
dictionary test's enumeration has to follow it.`,
    ).toEqual([])
  })

  it('exempts only real tuples, with a written one-line reason', () => {
    for (const exemption of EXEMPT_VOCABULARIES) {
      expect(
        tupleNames,
        `${exemption.name} is exempt but the contract does not export it`,
      ).toContain(exemption.name)
      expect(exemption.reason.trim(), `${exemption.name} is exempt with no reason`).not.toBe('')
      expect(
        exemption.reason,
        `${exemption.name}'s reason must be one line, not a paragraph`,
      ).not.toContain('\n')
    }
  })

  it('does not exempt a vocabulary the dictionary still answers for', () => {
    // An exemption records an absence, so it may not stand beside copy that
    // exists: that would be a way to silence the check rather than record a
    // retirement.
    const contradictory = exemptNames.filter(name => enumeratedNames.includes(name))
    expect(
      contradictory,
      `${contradictory.join(', ')} is both exempt in EXEMPT_VOCABULARIES and enumerated by the
dictionary test — delete the exemption: the dictionary test answers for the vocabulary.`,
    ).toEqual([])
  })
})
