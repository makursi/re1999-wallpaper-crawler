# The README style guide: principles, not a skeleton

## The question

Spec #124's trigger was a product document with no standard behind it: `README.md`
is the one document a release ships, and nothing in the repository said what it
must contain, so twelve accreted sections could state one fact twice and the
document could not name the release it describes. Google's README style guide
states the principles — name and location, five information points, short prose
— but adopting it needed a decision about how far it binds here and how a change
is checked. Which principles become the repository's rules, and which are
deliberately left out? (#125) `docs/notes/flat-package-release.md` already
settled that `README.md` is the one product document; this note governs how it
is written and does not reopen that.

## Settled

- **Principles, not a skeleton.** The guide states the five information points,
  the prose rules and the two-language rule. It prescribes no section skeleton
  and no section order, because the document's shape follows the product, and a
  mandated template would turn today's accretion into tomorrow's rule. (#125)
- **Audience-neutral vocabulary, with the repository-wide change deferred.** A
  product document names the product and its operations, never a population;
  the guide's rule line carries the retired words so the rule is executable.
  `CONTEXT.md`, `CONTEXT-MAP.md`, `CHANGELOG.md`, `HISTORY.md`, `docs/notes/` and
  the untouched lines of `AGENTS.md` keep their wording for now: retiring it
  everywhere would make this change unreviewable, and it is its own issue.
  (#125)
- **The status line is a version number checked against the manifest.** The
  document's status point becomes one line naming the release, and the document
  contract compares that number with `package.json`'s `version`. A forgotten
  edit fails a check instead of shipping a stale document, and the guide holds
  no literal that could drift. (#125)
- **The two variants are held by one set of assertions, not a comparison test.**
  The one document contract runs the same assertions over both files, so a fact
  present in one variant and missing from the other fails. A separate
  mirror-comparison test would assert shape instead of facts, and the guide
  refuses a shape. (#125)
- **The guide is a development document, and the whitelist proves it.** The
  archive's whitelist is a list of names and no `docs/` path has one, so the
  packager's predicate refuses `docs/readme-styleguide.md`; the whitelist test
  asserts that refusal, which makes "never ships" an enforced property rather
  than a note. (#125)
- **The guide is reached from the steering document.** `AGENTS.md` carries one
  pointer line to `docs/readme-styleguide.md`, and the document contract asserts
  both the pointer and the file's existence, so a session about to edit the
  product document finds the standard in the first file it reads. (#125)
- **The two variants landed as two commits, so the rule binds landing.** Tickets
  #126 and #127 landed the variants in separate commits on one branch. The guide
  therefore requires both variants to land together and neither to be merged
  without the other, instead of requiring one commit to carry both. (#126, #127)
- **The English rollback condition uses the stricter model.** The English
  variant says not to delete the old folder until the new version "has worked
  properly once", not the weaker "has run at least once": a reader who deletes
  the fallback after one failed launch has lost it. (#127)

## Open

- **The repository-wide vocabulary change.** The Prerequisites section of
  `AGENTS.md` is clean, and so are the two product documents. `CONTEXT.md`,
  `CONTEXT-MAP.md`, `CHANGELOG.md`, `HISTORY.md`, `docs/notes/` and the remaining
  `AGENTS.md` wording — including its description of `CHANGELOG.md` — still use
  the retired population labels; #129 sweeps them and decides the replacement
  shape per occurrence, the boundary for the dated records and the changelog's
  register. Its fallback, if it cannot be scheduled, is this state: the rule
  binds the product documents only, and the guide says so.

## Rejected

- **A fixed section skeleton.** Rejected: it would freeze the current twelve
  sections into a rule and make every legitimate reorganisation a violation. The
  five information points are the requirement; their order and headings are the
  document's to choose. (#125)
- **A heading-order test.** Rejected: once the guide refuses a skeleton, an
  order assertion would invent the structure the guide says does not exist, and
  a change that moved a fact without changing it would fail for no
  reader-visible reason. (#125)
- **Testing prose.** Rejected: a test cannot judge wording. The contract asserts
  only what can disagree with a file — a literal the document must carry, an
  agreement between two files, or a property the packager enforces — and the
  prose rules stay review rules. (#125)
- **A separate mirror-comparison test.** Rejected: comparing the variants
  directly would assert their shape and grow a second contract beside the first.
  The one document contract covering both files is how "one document" is
  enforced without prescribing a shape. (#125)
- **Restating the Node floor or the version in the guide.** Rejected: either
  literal would be a second truth that drifts from `package.json`. The document
  contract reads the Node floor from `engines.node` today and reads the status
  line's version from `version` after this change; the guide states neither.
  (#125)
- **The old "locate the problem much faster" promise.** Rejected: the guide bans
  an adjective that promises, and a speed claim is exactly that. The actionable
  half — attach the version and the newest run log — survived in both documents,
  and saying what to attach shortens a diagnosis without promising anything.
