# The Console is the human entry point, and every CLI entry stays

The repository owner scrapes by hand: a terminal, `pnpm save-wallpapers`, and
twenty minutes of a headed Chrome window that must not be touched. The one
capability a terminal genuinely cannot offer — setting the desktop wallpaper —
was considered and deliberately cut, so what is left is a page: start a Run,
watch it, and read the Mirror against the Gallery list. That page is the
**Console**, and it arrives as a third entry point rather than as a new front
end for the two that exist.

There is no dispatcher and no CLI framework. `save-wallpapers`, `check-run` and
`console` each keep pointing at their own file, and the three names stay exactly
as they are, because the runbook and the always-loaded agent instructions are
written against the first two. The Run report's documented consumer is an
agent, and a Run's entry point has to remain one command with one exit code and
one log file; putting a framework between the agent and those commands would
buy help output for commands nobody types, and risk exactly that.

The Console takes two flags and nothing more — `--port` (default 8791) and
`--no-open` — parsed with Node's built-in parser; there is no `--help`
framework, and the entries' documentation stays the repository's own prose. It
never imports the pipeline: `src/main.ts` calls `execSync` five times, one with
a 900-second timeout, which blocks the event loop for the whole of Discovery, so
a service sharing that process could not answer a request while a Run was in it
and a page fault could reach a Run in flight. The Console starts a Run as a
child process instead — the current Node binary with the tsx entry as its first
argument and the repository root as its working directory, never through a
shell and never through `npx`, because this repository's own notes record how
cmd.exe mangles the arguments such a launcher would pass.

## Considered options

- **Unify the three entries behind one subcommand CLI** (a `bin` with `run`,
  `check` and `console`): with the alias scripts preserved, no caller ever types
  the subcommands, so the framework would buy help output for commands nobody
  runs, and it would add a layer between an agent and the two commands its
  runbook names. Rejected.
- **Let the Console call the pipeline in-process** (a thin page over the
  exported functions): the orchestration entry point blocks the event loop for
  the whole of Discovery through `execSync`, so the service could not serve the
  page while a Run was in flight, and a UI fault would share a process with the
  Run it is watching. Rejected.
- **Make the Console the agent's entry point and retire a CLI alias**: the Run
  report's consumer is an agent and its reading rules are written against
  `save-wallpapers`' and `check-run`'s output; replacing either would break the
  runbook and the always-loaded instructions to save a human a keystroke.
  Rejected.
- **Give the Console its own run check** (a fourth command, or a check folded
  into `console`): the Console already reuses `check-run`'s parse-and-assess
  pair on the same newest Run log, so the page and the command cannot disagree;
  a second command would only add a second way to ask one question. Rejected.

## Consequences

- Three scripts to keep in step, each owning its own file. Nothing shares a
  dispatcher, so a change to one cannot silently change another's behaviour.
- The agent-facing interface does not change: the two CLI names, their exit
  codes, and the Run log, Run report and Gallery state contracts are untouched.
- The Console's verdict is `check-run`'s own pair rather than a re-derivation,
  which is what makes "the page and the command cannot disagree" structural
  (ADR 0009).
- The Console's page is the repository's first build artifact, so this decision
  also carries ADR 0011's scoped exception to the no-build rule.

Related: ADR 0009 (a Run's truth is its Run log, not the handle that started
it), ADR 0010 (thumbnails are generated outside the Mirror), ADR 0011 (the
Console brings the repository its first build artifact).
