# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root: it names the contexts (Discovery, Download,
  Gallery tracking) and how they relate. Read it first.
- **`CONTEXT.md`** at the repo root: the glossary. The map points into it by section
  (`Vocabulary in CONTEXT.md → Discovery`).
- **`docs/adr/`**: read the ADRs touching the area you're about to work in before
  changing pipeline internals — 0004 Site asset filter, 0005 the persisted gallery
  total (superseded), 0006 the gallery list is the source, and so on.
- **`HISTORY.md`**: not a glossary. It records *why* the code is shaped this way,
  including approaches that were tried and rejected, plus the open questions. Scan
  it before re-proposing anything it lists as rejected.

If any of these files don't exist, **proceed silently**. Don't flag their absence;
don't suggest creating them upfront. The `/domain-modeling` skill (reached via
`/grill-with-docs`) creates them lazily, when terms or decisions actually get
resolved.

## File structure

This repo declares **multiple contexts** — `CONTEXT-MAP.md` is present — but keeps
**one glossary file**: each context's vocabulary is a section of the root
`CONTEXT.md`, not a `CONTEXT.md` of its own. That is deliberate; the contexts share
the Wallpaper URL set vocabulary. So don't go looking for `src/<context>/CONTEXT.md`,
and don't create one to match a template.

```
/
├── CONTEXT-MAP.md          ← the contexts and their relationships
├── CONTEXT.md              ← one glossary, one section per context
├── HISTORY.md              ← why the code is shaped this way (+ rejected approaches)
├── docs/
│   ├── adr/                ← system-wide decisions
│   └── agents/             ← these files: how agents read the repo
└── src/
    ├── discovery/          ← traverses the page, produces the raw capture
    ├── download/           ← consumes the Wallpaper URL set, writes files
    ├── gallery/            ← the site's list, the mirror check, cross-Run memory
    └── report/             ← pure analysis: metrics, defects, the Run report
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a
hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to
synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're
inventing language the project doesn't use (reconsider), or there's a real gap
(note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0004 (filter Site assets out of the Wallpaper URL set), but worth
> reopening because…_
