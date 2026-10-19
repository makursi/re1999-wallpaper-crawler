# The human entry point is the `webui` command

The repository has two audiences with two entry points. An agent types
`save-wallpapers` and `check-run`, and those names are written into the runbook
and the always-loaded instructions. A human types one command, and that command
starts a local service that serves a page — and it was called `console` since
ADR 0008, which also fixed all three names in place.

The name is the thing that now fails. `console` is what a browser's developer
tools are called, and the repository never documented it: `README.md` listed
`test`, `typecheck`, `lint` and `fmt`, and not the one command a human is meant
to type. The page behind it is a local gallery of the Mirror and of the Gallery
list, so the command becomes `webui` and the page names itself **壁纸图鉴**.

- The script is `webui` (`pnpm webui`), and `console` is gone. No alias: the
  runbook names the other two entries, nothing outside this repository types
  this one, and two names for one entry re-create the ambiguity the rename
  removes.
- The domain term **Console** stays, and so do the file names that carry it
  (`web/server/console.ts`, `web/server/console-config.ts`,
  `web/src/console-token.ts`, `web/.console-cache/`). The term is the name of a
  context, a glossary entry, four ADRs and a directory of the tree; no human
  types a directory name, so renaming it is a repository-wide rewrite with no
  reader. The page's product name and the context's name are two different
  things, and this ADR keeps them apart: the context is the Console, the command
  is `webui`, the page says 壁纸图鉴.
- Everything that points a human at the command is updated in the same change:
  `AGENTS.md`'s command table, `CONTEXT-MAP.md`'s "started by the … script", and
  `README.md`, which gains the section it never had.
- The terminal banner becomes `WebUI: <url>`. The rest of the terminal's English
  prose stays for now; the interface becomes bilingual in its own iteration, and
  that iteration rewrites those sentences together with the page's.

## Considered options

- **Keep `console` and only document it**: rejected — the name is the problem,
  and a paragraph of documentation does not stop it from reading like a browser
  devtools console.
- **Rename the domain term and the files with it**: rejected — the term is
  referenced by dated ADRs and by a glossary whose English canonical names the
  Run log, the API contract and the code all use. The cost is a repository-wide
  rewrite; the benefit is zero, because the name a human types is the only name
  a human is exposed to.
- **Rename to `ui`, `serve` or `web`**: rejected — `dev:web` and `build:web`
  already name the page's tooling, `webui` says what the human gets (a page) and
  what it is not (a terminal), and it cannot be confused with either.
- **Keep `console` as a deprecated alias**: rejected, for the reason above, and
  because the alias would have to be kept in step in `package.json`, in the
  documentation and in every future reader's head.

## Consequences

- ADR 0008's naming sentence is superseded: the three names are now
  `save-wallpapers`, `check-run` and `webui`. Everything else in ADR 0008 — the
  child-process launcher, the two flags, the no-dispatcher decision, the CLI
  entries' contracts — stands, and that ADR is not edited, because it records
  the state of its day.
- A human has exactly one documented command, and `package.json`,
  `AGENTS.md`, `CONTEXT-MAP.md` and `README.md` agree on it.
- The page's title is Chinese while its other strings are still English; the
  bilingual interface closes that gap, and this ADR deliberately does not.

Related: ADR 0008 (the Console is the human entry point), ADR 0010 (thumbnails
live outside the Mirror), ADR 0011 (the start command builds the page).
