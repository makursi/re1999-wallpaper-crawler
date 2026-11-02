# README Style Guide

This guide governs the repository's product documents, `README.md` and
`README.en.md`. It applies [Google's README style guide](https://google.github.io/styleguide/docguide/READMEs.html)
as principles, not as a template: it prescribes no section skeleton and no
section order.

## Name and location

- The product document is `README.md`, at the repository root.
- It is never inside a documentation directory.
- The English variant is `README.en.md`, beside it at the root.

## The five points

A product document contains or points to all five:

1. What the product is and what it does.
2. How to operate it, with every command copyable and runnable verbatim.
3. Its status: the release the document describes, as a version number.
4. Where to ask, as a link to the repository's issue tracker.
5. Links to the repository's documentation.

The status line's version equals `package.json`'s `version`. Read it from the
manifest; this guide states no literal.

## Prose

- One step per line; number the steps when their order matters.
- Every command in backticks and copyable verbatim.
- No adjective that promises: state what the program does, not how well it does
  it.
- One fact in one place; a repeated fact is a contradiction waiting to happen.
- Short sentences, no preamble: a section's first line states its fact.

## Two languages, one document

- `README.md` and `README.en.md` carry the same facts, the same sections and the
  same order.
- Both variants land together: neither is merged without the other.

## Retired vocabulary

- A product document names the product and its operations, never a population:
  `玩家`, `使用者`, `开发者`, `player`, `players`, `developer`, `developers` are
  retired. This rule is their only occurrence in this guide; an occurrence in a
  product document fails its contract.

## Where this reading departs from the source

- The English variant's name is `README.en.md`, beside `README.md` at the root;
  Google's guide names one file.
- `docs/notes/README.md` and `docs/adr/README.md` are indexes under their own
  conventions, so these rules do not govern them.
- The document contract holds the status version against the manifest, the
  tracker link, the retired words and the commands the reader runs; the rest of
  the five points stays a review rule.

## The check a README change is held to

- The five points are present or pointed to.
- The status line's version equals `package.json`'s `version`.
- Both language variants land together.
- `pnpm test` is green.
