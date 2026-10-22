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
// The last tests read the repository's real `CHANGELOG.md`: the workflow calls
// this module on a tag, so the file has to keep answering — for the version
// `package.json` currently names, on top, and with nothing but versions using
// `##` above it.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { packageVersion } from '../../scripts/package-version.js'
import { checkTemplate, releaseSection, TEMPLATE_HEADINGS } from '../../scripts/release-notes.js'

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

/** The one version a release is named: `package.json` (scripts/package-version.ts). */
const PACKAGE_JSON = path.resolve(import.meta.dirname, '..', '..', 'package.json')

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

  it('reads the repository changelog, which the workflow depends on for 1.0.1', () => {
    const body = releaseSection(REPOSITORY_CHANGELOG, '1.0.1')
    expect(body.length).toBeGreaterThan(0)
    // The body is the section without its heading, and it is written for a
    // player: this release has to state that the page can exit the program.
    expect(body).not.toContain('## 1.0.1')
    expect(body).toMatch(/退出/)
  })

  it('opens with the shipped version, and the format rules are not a section', () => {
    // The header's own rule says the newest version goes on top and only
    // versions use `##`; a maintainer reading "opens with 1.0.1" must see that
    // the format notes are prose, not a release. The top heading must also be
    // the number `package.json` ships (#88 checks the tag against that one), so
    // a version bump that forgets its section fails here rather than in a draft
    // Release with an empty body.
    const headings = REPOSITORY_CHANGELOG.split(/\r?\n/).filter(line => line.startsWith('## '))
    for (const heading of headings) expect(heading).toMatch(/^## \d+\.\d+\.\d+$/)
    expect(headings[0]).toBe(`## ${packageVersion(PACKAGE_JSON)}`)
    // The first public release keeps its section: this is the record, not a
    // changelog that drops a version once a newer one lands.
    expect(headings).toContain('## 1.0.0')
  })
})

/** The version these fixtures release: the archive they have to name. */
const VERSION = '1.2.0'

/** A body that follows the template, so a test can break one rule at a time. */
const CONFORMING = [
  '### 新增',
  '',
  '- 新增「退出」：导航条点一下即结束程序。',
  '',
  '### 安装',
  '',
  '1. 下载 `re1999-wallpaper-crawler-v1.2.0.zip`。',
  '',
  '### 下载文件',
  '',
  '- `re1999-wallpaper-crawler-v1.2.0.zip` — Windows 10/11 64 位便携包。',
].join('\n')

describe('checkTemplate', () => {
  it('accepts a body that follows the template', () => {
    expect(() => checkTemplate(CONFORMING, VERSION)).not.toThrow()
  })

  it('refuses a second-level heading inside the body', () => {
    // `## ` is what ends a section, so a body carrying one would be cut short.
    const body = CONFORMING.replace('### 安装', '## 安装')

    expect(() => checkTemplate(body, VERSION)).toThrow(/1\.2\.0/)
    expect(() => checkTemplate(body, VERSION)).toThrow(/## /)
  })

  it('refuses a heading the template does not have', () => {
    const body = CONFORMING.replace('### 安装', '### 安装说明')

    expect(() => checkTemplate(body, VERSION)).toThrow(/安装说明/)
  })

  it('refuses headings written out of the template order', () => {
    const body = [
      '### 修复',
      '',
      '- 修复了闪退。',
      '',
      '### 新增',
      '',
      '- 新增了退出。',
      '',
      '### 安装',
      '',
      '1. 下载 `re1999-wallpaper-crawler-v1.2.0.zip`。',
      '',
      '### 下载文件',
      '',
      '- `re1999-wallpaper-crawler-v1.2.0.zip`。',
    ].join('\n')

    expect(() => checkTemplate(body, VERSION)).toThrow(/顺序|order/)
  })

  it('refuses the same section twice', () => {
    const body = CONFORMING.replace('### 安装', '### 新增\n\n- 新增了第二次。\n\n### 安装')

    expect(() => checkTemplate(body, VERSION)).toThrow(/新增/)
  })

  it('refuses a section with nothing in it', () => {
    const body = CONFORMING.replace('### 安装', '### 变更\n\n### 安装')

    expect(() => checkTemplate(body, VERSION)).toThrow(/变更/)
  })

  it('refuses a body with no change section at all', () => {
    const body = [
      '### 安装',
      '',
      '1. 下载 `re1999-wallpaper-crawler-v1.2.0.zip`。',
      '',
      '### 下载文件',
      '',
      '- `re1999-wallpaper-crawler-v1.2.0.zip`。',
    ].join('\n')

    expect(() => checkTemplate(body, VERSION)).toThrow(/1\.2\.0/)
    expect(() => checkTemplate(body, VERSION)).toThrow(/变更/)
  })

  it('refuses a preamble line before the first section', () => {
    const body = `只修用起来别扭的地方。\n\n${CONFORMING}`

    expect(() => checkTemplate(body, VERSION)).toThrow(/开场白|preamble/)
  })

  it('refuses 下载文件 that names another version', () => {
    // A section copied from the previous release is the failure this catches.
    const body = CONFORMING.split('v1.2.0.zip').join('v1.1.0.zip')

    expect(() => checkTemplate(body, VERSION)).toThrow(/1\.2\.0/)
  })

  it('refuses a personal pronoun', () => {
    const body = CONFORMING.replace('导航条点一下即结束程序', '点一下就能结束你的程序')

    expect(() => checkTemplate(body, VERSION)).toThrow(/你/)
  })

  it('does not mistake 其他 for a pronoun', () => {
    const body = CONFORMING.replace('导航条点一下即结束程序', '其他下载不受影响')

    expect(() => checkTemplate(body, VERSION)).not.toThrow()
  })

  it('accepts the repository changelog at the version package.json names', () => {
    const version = packageVersion(PACKAGE_JSON)

    expect(() =>
      checkTemplate(releaseSection(REPOSITORY_CHANGELOG, version), version),
    ).not.toThrow()
  })

  it('documents exactly the headings the validator accepts, in order', () => {
    // The template in the changelog's header is the rule a maintainer reads;
    // this is what keeps it from drifting away from the code that enforces it.
    const lines = REPOSITORY_CHANGELOG.split(/\r?\n/)
    const firstVersion = lines.findIndex(line => line.startsWith('## '))
    const documented = lines
      .slice(0, firstVersion)
      .filter(line => line.startsWith('### '))
      .map(line => line.slice(4).trim())

    expect(documented).toEqual([...TEMPLATE_HEADINGS])
  })
})
