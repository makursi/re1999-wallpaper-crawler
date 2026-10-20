# The WebUI is the only human entry, and the command line belongs to agents

The repository is presented as two products with two doors, and the door a new
user finds first is the wrong one. `README.md`'s quick start ends at a terminal
command whose name reads like user-facing copy, while the one command that
serves a page is introduced later, as a way to "view the Mirror". Worse, on a
machine that never ran this project that command does not reach the page at all:
`.env` is gitignored, and the Console's entry point imported a config module that
parses the environment at module load, so a fresh clone met a Zod stack trace
instead of a page. The script's name also leaked into the Run log's file name, a
hard-coded contract read by `check-run`, the Console, the tests and the README.

There is one human entry now, and the command line is the agent's interface.

- The page is the application and `pnpm webui` is the only command `README.md`
  teaches: install, one command, the page opens. The crawler and the verdict are
  `core:run` (`tsx core/main.ts`) and `check-run` (`tsx core/check-run.ts`) —
  names that read as internal tooling, documented in `AGENTS.md` and the
  save-images runbook, never in the README. `check-run` keeps its name, its file,
  its output and its exit codes.
- `save-wallpapers` is deleted and `core:run` replaces it, with no alias. The
  Console's launcher already spawns the tsx entry directly, so deleting the
  script changes no runtime behaviour — only the documented names move.
- A Run's log is `logs/run-<runId>.jsonl`. Both readers keep accepting the legacy
  `save-wallpapers-<runId>.jsonl` permanently: those files are a historical fact,
  not a transitional state, and nothing on disk is renamed or deleted, because
  the Run log is the audit trail (ADR 0007). The newest-Run pick orders by the
  `runId` the name carries, never by the whole file name: a plain string compare
  ranks every `save-wallpapers-…` after every `run-…` (`s` > `r`), so yesterday's
  legacy log would beat today's. One predicate, `logRunIdOf`, answers both "is
  this a Run log" and "which Run does this name belong to", and serves the pick,
  the verdict's log-to-Run identification and the tests.
- The Console boots with no usable `.env` — absent, unparsable or missing a
  required key. The configuration schema has exactly one home,
  `core/config-read.ts`; `core/config.ts` still parses it at import and exports
  the pipeline's constants, so the pipeline's own import keeps failing fast
  before a Run starts, and the Console uses the same schema's non-throwing read.
  With no usable file the page still opens, the wall still renders, and the
  Gallery list degrades to "not read" — `null`, never an empty list, and no
  request is made to a URL that does not exist. The Run panel's setup notice then
  says what to create: `.env` at the repository root, with the two site lines to
  paste, in both locales.
- `runConfigAvailable` — the fact behind that notice — is read per status
  request, not once at boot. It is one file read of `.env` through the same
  predicate the start's `env-file` refusal makes, with no `PATH` scan and no
  registry lookup. That predicate validates the whole configuration schema a Run
  parses, defaulted keys included, so a file it accepts cannot then fail the
  Run's own parse. This deliberately supersedes the earlier "boot fact" wording:
  a notice that never clears after the user creates the file is worse than one
  cheap file read, and the ambient notice and the click path cannot disagree.
- The Console writes nothing into the repository root. It reads `.env`, the
  Mirror and the Run log directory, and starts a Run as a child process; it never
  creates or edits `.env`, and it writes neither the Mirror nor a Run log. The
  page explains, the user creates.
- The page gains no stop control. The Run's truth is its log on disk, not a
  handle the page holds (ADR 0009), so stopping stays Ctrl+C in the terminal that
  runs the WebUI, and `README.md` says so.

## Considered options

- **Keep the old script name** — whether as the documented human path or beside
  the page: rejected. The name is user-facing copy for a command no user should
  type, and it is the first command the README would teach, which is exactly the
  wrong door this decision closes. The migration cost is one muscle-memory break,
  paid once and documented in the same change.
- **Keep `save-wallpapers` as an alias for `core:run`**: rejected, for the reason
  ADR 0012 used for `console` — the alias would have to be kept in step in
  `package.json`, in the documentation and in every future reader's head, and two
  names for one entry re-create the ambiguity the rename removes.
- **Let the page write `.env`**: rejected. Writing a file into the repository
  root is a new ownership the Console does not have, and the two lines are the
  site's constants, not user data — the page's job is to say what to create, not
  to create it silently. The start already refuses with a named `env-file`
  prerequisite, which teaches the same thing without a write.
- **Add a stop control to the page now**: rejected. ADR 0009 stands: the page is
  a view, a Run's truth is its log, and the whole-tree stop has no honest HTTP
  representation — a button would either lie about what it stopped or need a
  process handle the page deliberately does not keep. Ctrl+C in the terminal that
  runs the WebUI stops the service and, when the WebUI started it, the Run's
  whole tree.
- **Name the Run log after the command** (`core-run-<runId>.jsonl`, or keep
  `save-wallpapers-…`): rejected. A log name that carries a command name is a
  promise that the command never changes, and this iteration is proof that
  commands do change. `run-` names the Run and nothing else; the next rename of an
  entry cannot orphan the log or resurrect a deleted script's name on the page.
- **Re-derive the Gallery list endpoint on each request**, so a `.env` created
  after boot is picked up without a restart: rejected. The endpoint is part of the
  injected configuration and the list source is built once with its own TTL
  cache; re-deriving it per request would rebuild that source per status read and
  let the status half and the gallery rows disagree. The cost is stated plainly
  instead: a `.env` created after boot clears the notice and permits a start, but
  the site's list stays at "not read" until the WebUI restarts — the wall still
  shows the Mirror, it just cannot say what is missing.
- **Report `runConfigAvailable` once at boot** (the spec's first wording, shipped
  by #57): rejected after shipping it — the notice is shown on a page the user is
  already looking at, and a user who creates `.env` without restarting would face
  a warning that never clears. The per-request read is the cheap file read; the
  `PATH` scan and the registry lookup stay where they were, in the start's
  prerequisite check.

## Consequences

- ADR 0012's naming clause is superseded: the three names are now `core:run`,
  `check-run` and `webui`. Everything else in ADR 0012 stands — the two flags,
  the loopback-only service, the no-dispatcher decision — and neither ADR 0008
  nor 0012 is edited, because they record the state of their day. ADR 0011's
  note that `save-wallpapers` and `check-run` keep the no-build property is
  equally a dated statement; `core:run` inherits it.
- A new user has exactly one documented command, and `package.json`,
  `README.md`, `AGENTS.md`, `CONTEXT-MAP.md` and the runbook agree on which
  audience each name belongs to.
- The mixed-prefix ordering is permanent: every reader of `logs/` treats both
  prefixes as Run logs and orders by `runId`. `check-run`'s "no log" line no
  longer names the deleted script.
- A machine with no `.env` reaches the page, the wall and a setup notice, and a
  start is refused naming `env-file`. The Gallery list is the one thing a
  post-boot `.env` cannot turn on; that needs a WebUI restart, and this ADR says
  so rather than implying otherwise.
- The setup notice is dictionary copy in both locales, so it cannot ship in one
  language; the dictionary's completeness test covers it (ADR 0014).
- The page still has no stop control, and the README says Ctrl+C is the stop.

Related: ADR 0007 (the Run log is written synchronously), ADR 0008 (the Console
is the human entry point), ADR 0009 (a Run's truth is its Run log), ADR 0011
(the page is the first build artifact), ADR 0012 (the command is `webui`), ADR
0014 (the interface speaks two languages).
