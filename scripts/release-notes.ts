#!/usr/bin/env node
// ── The Release body is the changelog's section (#88) ───────────────
//
// `CHANGELOG.md` is the one user-readable record of what changed, written for a
// player. The draft Release's body is cut out of it, so the maintainer writes
// the notes once. The extraction rule is stated in the changelog's own header
// and implemented here; both have to agree, and the tests hold the rule:
//
//   - a release is one level-2 heading written exactly `## <version>`;
//   - its body runs from the line after the heading to the next level-2
//     heading (or the end of the file);
//   - the heading itself is not part of the body — the Release's name is the
//     tag, which already carries the version;
//   - a missing, empty or duplicated section is a loud failure naming the
//     version. A Release with an empty body is worse than a failed job.
//
// ── The body follows one template (#101) ────────────────────────────
//
// Every version section is an instance of the template the changelog's header
// states: seven `###` headings in a fixed order, at least one change section,
// 安装 and 下载文件 in every release, no preamble line, and no personal
// pronouns. `checkTemplate` is the executable half of that rule; the
// imperative mood itself is left to the template's example and to review,
// because a word list cannot see it.
//
// CLI (the workflow's "extract the notes" step):
//
//   tsx scripts/release-notes.ts 1.0.0
//   tsx scripts/release-notes.ts 1.0.0 --out release-notes.md
//
// Without `--out` the body goes to stdout; with it, the file is written as
// UTF-8 with a final newline, so `gh release create --notes-file` gets exactly
// the text and no shell re-encoding. Every failure goes to stderr and exits
// non-zero.

import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

/** The repository root: this script's parent. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..')

/** The one user-readable record. */
const CHANGELOG_FILE = path.join(REPO_ROOT, 'CHANGELOG.md')

/** The marker a release heading starts with. Only this level ends a section. */
const RELEASE_HEADING = '## '

/** The marker a template section starts with: the only heading a body may use. */
const SECTION_HEADING = '### '

/**
 * Exactly one version's section body, or a failure naming the version.
 *
 * The text is split on either line ending so a Windows checkout of the file
 * reads the same as the committed LF one; the returned body keeps the file's
 * own line structure.
 */
export function releaseSection(changelog: string, version: string): string {
  if (version.trim() === '') {
    throw new Error('release notes: no version was given — say which section the Release needs')
  }

  const heading = `${RELEASE_HEADING}${version}`
  const lines = changelog.split(/\r?\n/)

  const starts: number[] = []
  lines.forEach((line, index) => {
    // Trailing spaces are invisible to a reader and harmless; anything else on
    // the line means it is a different heading.
    if (line.trimEnd() === heading) starts.push(index)
  })

  if (starts.length === 0) {
    throw new Error(
      `release notes: the changelog has no "${heading}" section — add it with what changed ` +
        'for the player. A Release with no body is worse than a failed job.',
    )
  }
  if (starts.length > 1) {
    throw new Error(
      `release notes: "${heading}" appears twice in the changelog — one section per version, ` +
        'because the release body cannot choose between them.',
    )
  }

  const start = starts[0] ?? 0
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index]?.startsWith(RELEASE_HEADING)) {
      end = index
      break
    }
  }

  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
  if (body === '') {
    throw new Error(
      `release notes: the "${heading}" section is empty — a Release with no body is worse ` +
        'than a failed job.',
    )
  }
  return body
}

/** The template's sections, in the order a release body writes them. */
export const TEMPLATE_HEADINGS: readonly string[] = [
  '新增',
  '变更',
  '修复',
  '破坏性变更',
  '安装',
  '升级说明',
  '下载文件',
]

/** At least one of these has to appear: a release changed something. */
const CHANGE_HEADINGS: readonly string[] = ['新增', '变更', '修复']

/** Every release carries these, so their absence is a template violation. */
const ALWAYS_HEADINGS: readonly string[] = ['安装', '下载文件']

/**
 * Words that address the reader. The body states what changed, so it has no
 * narrator and no "you"; the list is ordered longest first so the message
 * names the word that was actually written.
 */
const PRONOUNS: readonly string[] = [
  '我们',
  '咱们',
  '大家',
  '各位',
  '它们',
  '你',
  '您',
  '我',
  '它',
  '他',
  '她',
]

/** Ordinary words that contain a pronoun character and are not pronouns. */
const COMPOUNDS: readonly string[] = ['其他', '其它', '迷你', '自我']

/** One `###` section: its heading, the heading's line, and the lines under it. */
interface Section {
  readonly heading: string
  /** The heading's 1-based line within the body. */
  readonly line: number
  /** The lines between this heading and the next one. */
  readonly body: string[]
}

/** The body split at its section headings, in the order they appear. */
function sectionsOf(lines: readonly string[]): Section[] {
  const sections: Section[] = []
  let current: Section | undefined
  lines.forEach((line, index) => {
    if (line.startsWith(SECTION_HEADING)) {
      current = { heading: line.slice(SECTION_HEADING.length).trim(), line: index + 1, body: [] }
      sections.push(current)
      return
    }
    current?.body.push(line)
  })
  return sections
}

/** The first pronoun a line addresses the reader with, if any. */
function pronounIn(line: string): string | undefined {
  let stripped = line
  for (const compound of COMPOUNDS) stripped = stripped.split(compound).join(' ')
  return PRONOUNS.find(pronoun => stripped.includes(pronoun))
}

/**
 * The template's rules, applied to one version's body.
 *
 * Throws on the first violation, naming the version and the line, because the
 * caller is a release job that has to say what to fix. A body that passes has
 * the shape the changelog's header documents; its wording is not checked.
 */
export function checkTemplate(body: string, version: string): void {
  if (version.trim() === '') {
    throw new Error(
      'release notes: no version was given — the template checks the package the body names',
    )
  }

  const lines = body.split(/\r?\n/)

  lines.forEach((line, index) => {
    if (line.startsWith(RELEASE_HEADING)) {
      throw new Error(
        `release notes: ${version}'s body has a "${RELEASE_HEADING}" heading at line ${index + 1} — ` +
          'a second-level heading ends the section, so the body may only use "### "',
      )
    }
  })

  const first = lines.findIndex(line => line.trim() !== '')
  if (first === -1) {
    throw new Error(`release notes: ${version}'s body is empty`)
  }

  const opening = lines[first] ?? ''
  if (!opening.startsWith(SECTION_HEADING)) {
    throw new Error(
      `release notes: ${version}'s body opens with "${opening.trim().slice(0, 40)}" — the template ` +
        'has no preamble; the first line is a "### " section heading',
    )
  }

  const sections = sectionsOf(lines)

  let previous = -1
  const seen = new Set<string>()
  for (const section of sections) {
    const order = TEMPLATE_HEADINGS.indexOf(section.heading)
    if (order === -1) {
      throw new Error(
        `release notes: ${version} has a "${section.heading}" heading at line ${section.line} that ` +
          `the template does not have — the template is ${TEMPLATE_HEADINGS.join(' / ')}`,
      )
    }
    if (seen.has(section.heading)) {
      throw new Error(
        `release notes: ${version} writes "${section.heading}" twice (line ${section.line}) — one ` +
          'section per heading',
      )
    }
    if (order < previous) {
      throw new Error(
        `release notes: ${version} writes "${section.heading}" (line ${section.line}) out of the ` +
          `template order — write ${TEMPLATE_HEADINGS.join(' → ')}`,
      )
    }
    seen.add(section.heading)
    previous = order

    if (section.body.every(line => line.trim() === '')) {
      throw new Error(
        `release notes: ${version}'s "${section.heading}" section (line ${section.line}) is empty — ` +
          'write what changed, or drop a section that does not apply',
      )
    }
  }

  if (!CHANGE_HEADINGS.some(heading => seen.has(heading))) {
    throw new Error(
      `release notes: ${version} has no change section — write at least one of ` +
        CHANGE_HEADINGS.join(' / '),
    )
  }

  for (const heading of ALWAYS_HEADINGS) {
    if (!seen.has(heading)) {
      throw new Error(
        `release notes: ${version} has no "${heading}" section — every release carries it`,
      )
    }
  }

  const assets = sections.find(section => section.heading === '下载文件')
  const archive = `re1999-wallpaper-crawler-v${version}.zip`
  if (assets !== undefined && !assets.body.join('\n').includes(archive)) {
    throw new Error(
      `release notes: ${version}'s "下载文件" section (line ${assets.line}) does not name ` +
        `${archive} — the body has to name this version's package`,
    )
  }

  for (const section of sections) {
    section.body.forEach((line, offset) => {
      const pronoun = pronounIn(line)
      if (pronoun !== undefined) {
        throw new Error(
          `release notes: ${version} has "${pronoun}" at line ${section.line + offset + 1} — the ` +
            'body is written without personal pronouns; say what changed, not to whom',
        )
      }
    })
  }
}

/** The command: version, optional output file, one body. */
function main(argv: readonly string[]): void {
  let version: string | undefined
  let output: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--out') {
      index += 1
      const file = argv[index]
      if (file === undefined || file === '') {
        throw new Error('release notes: --out needs a file path')
      }
      output = file
    } else if (version === undefined) {
      version = argument
    } else {
      throw new Error(
        'release notes: usage — tsx scripts/release-notes.ts <version> [--out <file>]',
      )
    }
  }

  if (version === undefined) {
    throw new Error('release notes: usage — tsx scripts/release-notes.ts <version> [--out <file>]')
  }

  const section = releaseSection(fs.readFileSync(CHANGELOG_FILE, 'utf8'), version)
  // The template is checked before anything is written: a Release body that
  // breaks it is a failed job, not a published page.
  checkTemplate(section, version)
  const body = `${section}\n`
  if (output === undefined) {
    process.stdout.write(body)
  } else {
    fs.writeFileSync(output, body, 'utf8')
  }
}

// Run only as a command, so the tests can import the function above.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
