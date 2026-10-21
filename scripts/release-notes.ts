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

  const body = `${releaseSection(fs.readFileSync(CHANGELOG_FILE, 'utf8'), version)}\n`
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
