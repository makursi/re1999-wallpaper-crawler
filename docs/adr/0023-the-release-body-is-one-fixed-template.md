# The release body is one fixed template, cut from the changelog

`CHANGELOG.md` is the one user-readable record, and a Release's body is the
matching `## X.Y.Z` section cut out of it verbatim (#88). That left the body's
*shape* to whoever wrote the release: 1.0.0 opened with a paragraph and then
topic headings (「你的文件在哪」「怎么更新」「关于版权」), 1.0.1 with a different
paragraph and different topic headings (「可以从页面退出」「运行面板只剩四行」).
A player opening the Releases page could not tell where "what changed" ends and
"how do I install this" begins, the answer moved every release, and the parts
that are the same in every release — download the zip, extract it, double-click
`启动.bat`, this is the archive — were rewritten by hand and could go stale.

This ADR records the template that replaced that, the gate that enforces it, and
what the uniformity costs. The template itself lives in the changelog's header,
where the maintainer writes it; this record is the *why*, and it does not copy
the literal block, so the two cannot drift apart.

## The shape

Seven `###` sections in a fixed order: 新增, 变更, 修复, 破坏性变更, 安装,
升级说明, 下载文件. Only `###` is allowed — a `## ` line ends a section, so a
second-level heading inside the body would truncate it to empty and the job would
draft a Release with no notes. A `#` or `####` line is refused for the other
half of the same reason: it would hide inside the previous section and make an
empty section look filled.

- At least one of 新增 / 变更 / 修复, because a release changed something.
- 安装 and 下载文件 in every release, with the same text each time.
- 破坏性变更 and 升级说明 only when they apply, and never written as 无: a
  section that says nothing is attention spent for no answer.
- The body starts at its first `###`. No preamble line.
- Every bullet opens with a verb, and no personal pronoun (你, 您, 我, 我们,
  咱们, 它, 它们, 他, 她, 大家, 各位) appears anywhere.
- 下载文件 names `re1999-wallpaper-crawler-v<version>.zip` — the one archive the
  release carries (ADR 0021) — beside GitHub's `Source code (zip)`.

The headings are Chinese because the body is: the changelog is written for a
player who reads Chinese, and the Release page is that file's section. The
template's example, the rules and every instance are one language, so there is
one thing to read rather than a glossary of headings.

## The gate

`scripts/release-notes.ts` checks the extracted body before it writes anything,
so a tag fails in seconds rather than publishing a malformed body: no heading
level other than `###`, headings a subset of the seven in order and without
duplicates, no empty section, no section whose only content is 无, at least one
change section, 下载文件 naming this version's package, no banned pronoun. A
failure names the version and the line, because its reader is a maintainer
looking at a red job.

The heading list is exported from the same module, and a test locates the
template block in the changelog's header and compares its `###` lines with that
list: the document a maintainer reads and the code that refuses their body
cannot disagree on the sections. The pronoun list and the at-least-one / always
sets live in that module alone; the header states them in prose and no test pins
them. The repository's own current version is checked by the test suite too, so
a version bump that forgets its section fails before the tag exists.

What no gate sees is the prose: the imperative mood and the verb-initial bullet.
A word list can find 你; it cannot tell 「精简运行面板：只留四行」 from a sentence
about the panel. The template's example and review carry that half, and this
record says so rather than implying the gate is complete.

## What it costs

- The narrator's voice is gone. 1.0.1 read like a person explaining a change; it
  now reads like a list, and the warmth survives only in the bullets' wording.
- Every release repeats 安装 and 下载文件 verbatim; a change to either is a
  change to every release's body.
- 1.0.0's 你的文件在哪 / 怎么更新 / 关于版权 sections were deleted rather than
  translated into a section: the template has no place for documentation, and
  the manual inside the package and the README already carry it.
- Both published bodies were rewritten, because a uniform archive matters more
  than the exact sentences 1.0.0 and 1.0.1 were published with. The notes
  changed; the assets, the tags and the publish state did not.
- A release with one fix is three sections — 修复, 安装, 下载文件 — where it
  used to be one paragraph.

## Considered options

- **Keep the narrative and only document the template**: rejected. The body *is*
  the changelog's section, so a template the file does not follow is a rule
  nobody keeps; the drift is the thing this change exists to end.
- **Generate 安装 and 下载文件 from the version** instead of writing them each
  release: rejected. The body would stop being the section the maintainer wrote
  — the changelog would no longer show what the Release says, and reading the
  body would mean reading code. Repetition is the cheaper cost.
- **A separate Release body file per version**: rejected. Two records of the
  same release, and the "write it once" invariant (#88) dies with the second.
- **Keep the `## What's Changed` wrapper** the template arrived with: rejected.
  A `## ` line ends the section, and semantically 安装 is not a change.
- **Enforce the imperative mood mechanically**: rejected as above — it is not
  checkable; the pronoun list is the part that is.

## Consequences

- Every future version section is an instance of the template; the release job
  and `pnpm test` both refuse one that is not.
- The changelog header is normative: it states the rules and holds the literal
  template, and a test pins it to the validator.
- A release body no longer carries where the player's files are or how to
  update; the manual inside the package is the one place for that (ADR 0019,
  #89).
- The glossary names the body: **Release notes (发布说明)**.

Related: ADR 0021 (the release is one portable zip, and the body names it), #88
(the body is the changelog's section), #101 (this record).
