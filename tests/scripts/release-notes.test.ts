// ── The Release body is the changelog's section (#88) ───────────────
//
// `CHANGELOG.md` is the one user-readable record, and the draft Release's body
// is cut out of it so the maintainer never writes the same notes twice. The
// extraction rule is stated in the changelog's own header, and these tests are
// the rule in executable form:
//
//   - a release is one level-2 heading written exactly `## <version>`;
//   - its body runs from the line after that heading to the next level-2
//     heading, and the heading itself is not part of the body (the Release's
//     name already carries the version);
//   - a missing section, an empty section or a duplicated section is a failure
//     naming the version — an empty Release body is worse than a failed job.
//
// The last test reads the repository's real `CHANGELOG.md`: the workflow will
// call this module on the tag `v1.0.0`, so the file has to keep answering.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { releaseSection } from '../../scripts/release-notes.js'

const CHANGELOG = `# 变更记录

格式说明：每个版本一个 \`## <版本号>\` 标题。

## 1.0.0

第一个公开版本。

### 它能做什么

- 双击就能用。

## 0.9.0

上一个版本。
`

/** The repository's real changelog: the workflow calls the CLI on this file. */
const REPOSITORY_CHANGELOG = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', '..', 'CHANGELOG.md'),
  'utf8',
)

describe('releaseSection', () => {
  it('returns exactly the body of that version, without its heading', () => {
    expect(releaseSection(CHANGELOG, '1.0.0')).toBe(
      ['第一个公开版本。', '', '### 它能做什么', '', '- 双击就能用。'].join('\n'),
    )
  })

  it('stops at the next version, and reads the last version to end of file', () => {
    expect(releaseSection(CHANGELOG, '0.9.0')).toBe('上一个版本。')
  })

  it('keeps the body verbatim, including a section that uses third-level headings', () => {
    // The rule says only `##` ends a section, so `###` subsections are body.
    expect(releaseSection(CHANGELOG, '1.0.0')).toContain('### 它能做什么')
  })

  it('fails loudly, naming the version, when the section is missing', () => {
    expect(() => releaseSection(CHANGELOG, '1.2.0')).toThrow(/1\.2\.0/)
    expect(() => releaseSection(CHANGELOG, '1.2.0')).toThrow(/no .*section/i)
  })

  it('fails when the section is present but empty', () => {
    // The heading exists and the next heading follows immediately: a job that
    // drafted a Release with no body would be worse than one that failed here.
    const empty = '## 1.2.0\n\n## 1.1.0\n\n有内容。\n'

    expect(() => releaseSection(empty, '1.2.0')).toThrow(/1\.2\.0/)
    expect(() => releaseSection(empty, '1.2.0')).toThrow(/empty/i)
  })

  it('fails when the section has only whitespace', () => {
    expect(() => releaseSection('## 1.2.0\n\n   \n\t\n## 1.1.0\n', '1.2.0')).toThrow(/1\.2\.0/)
  })

  it('fails when the same version appears twice instead of choosing one', () => {
    const duplicated = '## 1.0.0\n\n先写的。\n\n## 1.0.0\n\n后写的。\n'

    expect(() => releaseSection(duplicated, '1.0.0')).toThrow(/1\.0\.0/)
    expect(() => releaseSection(duplicated, '1.0.0')).toThrow(/twice|2 times|duplicate/i)
  })

  it('does not mistake a longer heading for the version', () => {
    // `## 1.0.0-rc.1` is not `## 1.0.0`; a prefix match would draft the wrong
    // body for a version that has no section at all.
    expect(() => releaseSection('## 1.0.0-rc.1\n\n预发布。\n', '1.0.0')).toThrow(/1\.0\.0/)
  })

  it('reads the repository changelog, which the workflow depends on for 1.0.0', () => {
    const body = releaseSection(REPOSITORY_CHANGELOG, '1.0.0')
    expect(body.length).toBeGreaterThan(0)
    // The body is the section without its heading, and it is written for a
    // player: the one fact this release has to state is that nothing installs.
    expect(body).not.toContain('## 1.0.0')
    expect(body).toMatch(/Chrome|终端|命令行/)
  })

  it('opens with the first public version, and the format rules are not a section', () => {
    // The header's own rule says the newest version goes on top and only
    // versions use `##`; a maintainer reading "opens with 1.0.0" must see that
    // the format notes are prose, not a release.
    const headings = REPOSITORY_CHANGELOG.split(/\r?\n/).filter(line => line.startsWith('## '))
    expect(headings[0]).toBe('## 1.0.0')
  })
})
