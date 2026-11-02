# Coding Standards

The Standards axis of a review reads this file. It is a pointer document: every
standard has one home, and this file names it, so the rule is read where it
lives. A copy here would be a second home, and the second copy is the one that
drifts.

## Where the standards live

- **Code style** — `AGENTS.md`, the "Code style" section: lint and format, the
  language and module shape, the page's file buckets and naming, and the
  service's transport adapter. The toolchain's configuration is the source of
  truth beneath it, and this document does not repeat what it enforces.
- **The steering file's ceiling** — `tests/docs/steering-file.test.ts`, which
  enforces the 24,000-byte budget and states the disclosure rule its failure
  message carries: `AGENTS.md` is a map, not a manual. It stays inside that
  budget, and material that does not fit belongs in a document the map points
  at.
- **Module ownership** — `docs/agents/architecture.md`, the annotated tree: one
  line per module with what it owns and whether it is unit-tested. Open it before
  moving a module or deciding which file owns a rule; the standards review cites
  it as the authority for module ownership.
- **Domain vocabulary** — `CONTEXT-MAP.md`, which names the contexts and how
  they relate, and `CONTEXT.md`, the single glossary with one section per
  context. A review uses the glossary's terms, not a synonym for them.
- **Decisions** — `docs/adr/`, one decision per file, indexed by subject in
  `docs/adr/README.md`. Read the ADRs touching the area before changing it; a
  contradiction is surfaced rather than silently overridden.

`HISTORY.md` is not a standards source. It is a dated record, and the boundary
below is about it.

## The rule no guardrail can enforce

A diff that changes behaviour updates the live prose that describes it — module
headers, architecture lines, injected-contract comments, check-script comments.

Types, lint and format are checked; whether a sentence is still true is not. The
live prose is present-tense: it says what the code does now. When the diff
changes what a module does, what a caller injects, what a script checks, or where
a module sits in the tree, the sentence beside it is part of the change, not
follow-up work.

## The boundary: live prose is not a dated record

`HISTORY.md` and the ADRs are dated records. They quote the tree of the day they
were written and are deliberately not re-pointed when the tree moves: rewriting
their paths would destroy the record of what was true then. A decision that
changes is a new ADR superseding the old one, not an edit to the old one.

The distinction is time, not file type:

- **Live prose** describes the tree now, so a behaviour change updates it.
- **A dated record** describes the tree then, so a moved file stays quoted as it
  was.

A review reports a stale module header, architecture line, injected-contract
comment or check-script comment as a finding. It does not report a `HISTORY.md`
entry or an older ADR that names a path which no longer exists: that record is
doing its job.
