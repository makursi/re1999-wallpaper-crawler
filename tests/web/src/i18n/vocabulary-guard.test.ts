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
// The reader accepts all three shapes a runtime tuple takes: `export const
// NAME = [ ... ]`, the same with `as const`, and the annotated `export const
// NAME: <type> = [ ... ]`. A bare literal is a runtime vocabulary too, and an
// annotated one is the same tuple with its element type named, so anchoring on
// `as const` (or on the bare `=` alone) would leave those shapes unmentioned.
//
// The exemption rules are a pure function taking its three inputs, because the
// committed list is empty today: asserting only over `EXEMPT_VOCABULARIES`
// would never execute a single rule. The rules are therefore tested against
// synthetic lists, and the committed list is checked with the same function.
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
 * and a vocabulary the dictionary still answers for may not be listed. Those
 * four rules are `exemptionProblems` below, tested on its own lists.
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

/**
 * One exported runtime tuple declaration, in any of the three shapes: `export
 * const NAME = [ ... ]`, the same with `as const`, and the annotated `export
 * const NAME: <type> = [ ... ]`. The initializer has to be an array literal.
 * The annotation is matched on one line and may not contain `=`; a function
 * type's `=>` is the one shape this leaves alone, and the contract has no such
 * vocabulary.
 */
const TUPLE_DECLARATION = /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*?)?=\s*\[/g

/**
 * Every exported runtime tuple literal in a source file, however it is laid
 * out. All three declaration shapes count: a bare literal is still a runtime
 * vocabulary, and an annotated one is the same tuple with its element type
 * named. A type-only export and a non-literal initializer have no runtime shape
 * to enumerate, and a declaration that is not `export const` is not the
 * contract's vocabulary form.
 */
function exportedTupleNames(source: string): string[] {
  const code = codeOnly(source)
  const names: string[] = []
  for (const match of code.matchAll(TUPLE_DECLARATION)) {
    const open = (match.index ?? 0) + match[0].length - 1
    if (closingBracket(code, open) === -1) continue
    names.push(match[1])
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

/**
 * Why an exemption list is not usable, in the words the failure prints; an
 * empty list is a valid one. Pure and given its three inputs, so the rules can
 * be exercised against synthetic lists instead of only against the committed
 * (today empty) one.
 */
function exemptionProblems(
  exemptions: readonly ExemptVocabulary[],
  tupleNames: readonly string[],
  enumeratedNames: readonly string[],
): string[] {
  const problems: string[] = []
  for (const { name, reason } of exemptions) {
    if (!tupleNames.includes(name)) {
      problems.push(`${name} is exempt but web/api-types.ts exports no such tuple`)
    }
    if (reason.trim() === '') {
      problems.push(`${name} is exempt with no reason`)
    } else if (reason.includes('\n')) {
      problems.push(`${name}'s reason must be one line, not a paragraph`)
    }
    if (enumeratedNames.includes(name)) {
      problems.push(
        `${name} is both exempt and enumerated by the dictionary test — delete the
exemption: the dictionary test answers for the vocabulary.`,
      )
    }
  }
  return problems
}

describe('the contract reader', () => {
  it('finds each accepted shape — bare, `as const` and annotated — however laid out', () => {
    const source = [
      '/** Why a Run was refused. */',
      'export const AS_CONST = [',
      "  'run-busy', // the next start would collide",
      "  'orphaned-run',",
      '] as const',
      '',
      "export const BARE = ['env-file']",
      '',
      "export const ANNOTATED: readonly string[] = ['clean', 'explained']",
      '',
      "export const ANNOTATED_AS_CONST: ReadonlyArray<string> = ['defect'] as const",
    ].join('\n')

    expect(exportedTupleNames(source)).toEqual([
      'AS_CONST',
      'BARE',
      'ANNOTATED',
      'ANNOTATED_AS_CONST',
    ])
  })

  it('rejects a comment, a string, a non-export, a non-const, a non-literal and a type', () => {
    // Each accepted shape has a decoy that spells it but is not a runtime
    // tuple: a commented-out declaration, the same words inside a string, a
    // declaration that is not exported, one that is not `const`, one whose
    // initializer is not a literal, and a function type whose `=>` is not the
    // tuple's `=`.
    const source = [
      "// export const COMMENTED_OUT = ['nope'] as const",
      "/* export const BLOCK_COMMENTED = ['nope'] as const */",
      "export const DESCRIBES_ITSELF = 'export const PROSE = [] as const'",
      "const NOT_EXPORTED = ['nope']",
      "export let NOT_CONST = ['nope']",
      'export const NOT_A_LITERAL = SOME_ARRAY',
      'export const A_FUNCTION: () => string = () => "nope"',
      'export type NOT_RUNTIME = readonly string[]',
    ].join('\n')

    expect(exportedTupleNames(source)).toEqual([])
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

describe('the exemption rules', () => {
  const NAME = 'RETIRED_CODES'
  const reason = 'the page stopped speaking it in #112'

  it('accept a real tuple with a one-line reason', () => {
    expect(exemptionProblems([{ name: NAME, reason }], [NAME], [])).toEqual([])
  })

  it('reject a name the contract does not export', () => {
    const problems = exemptionProblems([{ name: NAME, reason }], ['OTHER_CODES'], [])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(`${NAME} is exempt but`)
  })

  it('reject a missing or empty reason', () => {
    for (const bad of ['', '   ', '\n']) {
      const problems = exemptionProblems([{ name: NAME, reason: bad }], [NAME], [])
      expect(problems, `a reason of ${JSON.stringify(bad)} was accepted`).toHaveLength(1)
      expect(problems[0]).toContain('no reason')
    }
  })

  it('reject a reason that is a paragraph', () => {
    const problems = exemptionProblems(
      [{ name: NAME, reason: 'first line\nsecond line' }],
      [NAME],
      [],
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('one line')
  })

  it('reject an exemption the dictionary test still enumerates', () => {
    const problems = exemptionProblems([{ name: NAME, reason }], [NAME], [NAME])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('both exempt and enumerated')
  })
})

describe('every runtime vocabulary the contract exports', () => {
  const tupleNames = exportedTupleNames(fs.readFileSync(CONTRACT_FILE, 'utf8'))
  const enumeratedNames = enumeratedTupleNames(fs.readFileSync(DICTIONARY_TEST_FILE, 'utf8'))

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
    const exemptNames = EXEMPT_VOCABULARIES.map(entry => entry.name)
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

  it('keeps the exemption list usable — real, reasoned, one line, and not also enumerated', () => {
    // The committed list is empty, so this is the same function the synthetic
    // cases above exercise; it is asserted here so the day an exemption lands
    // the rules already run over it.
    expect(exemptionProblems(EXEMPT_VOCABULARIES, tupleNames, enumeratedNames)).toEqual([])
  })
})
