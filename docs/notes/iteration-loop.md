# The iteration loop pays its three debts

## The question

An iteration of this project is two things: the player's change, and the loop
that produces it. The loop that produced #107 (18 sessions, 929 steps, 1,330 tool
calls) delivered a correct change and still paid the same three debts on every
run. None of them was a judgement error, which is why no amount of care fixed
them. What structure pays each debt once, for every future iteration, without
changing anything a player sees?

The three debts:

1. **The built tree is never booted in CI.** `build/` is the program — the
   package ships it and `pnpm webui` runs it — and the
   `const require = createRequire(import.meta.url)` banner exists because an ESM
   bundle of a CommonJS package dies at import: a class of failure that
   typecheck, lint and a thousand tests all pass through. CI built the page
   bundle only, so the three program entries and the boot were first compiled
   and first run on a tag. The one check that catches this class ran on the
   maintainer's desk — a smoke script in a git-ignored, machine-local scratch
   directory, hand-written during one ticket and hand-rewritten during another,
   one rewrite of which carried a token bug that only a real run exposed.
2. **A git worktree is a different, half-broken machine.** Its `node_modules`
   is a junction onto the parent checkout, and pnpm 12's pre-script install
   refuses to write through it. In one fan-out, `pnpm <script>` failed 53 times
   with `workspace hoist directory is not a real directory`, then printed
   "your node_modules may be out of sync with your lockfile" — a warning that
   points at the wrong problem. Every one of six implementing agents invented
   the same 120-character `npm_config_*` prefix and pasted it onto every
   command; the sentence that actually explained it existed only inside a
   prompt one agent had ticked.
3. **A design session leaves nothing behind.** The same question was opened
   three times in twelve minutes, each restart re-reading the same eight files
   and ending in the same fact-dump; the third only worked because the
   maintainer pasted the answer into the prompt. Two later design threads
   reached a clear recommendation and then ended with no issue, no plan and no
   branch. A decision has no place to land until someone writes code, so a
   decision that is not implemented that day is re-derived.

Two smaller debts were paid in the same place:

4. **A number cannot resolve to an ADR.** Twenty-three ADRs had no index; an
   agent guessed three filenames wrong in one day (`0016`, `0014`, `0022`),
   because a decision's subject cannot be derived from its number.
5. **The always-loaded steering file is a cache of lookups.** 385 lines /
   34.5 KB in every turn, of which 119 lines are Gotchas that only packaging,
   build and Run-log work needs, and one paragraph restates the formatter's own
   configuration.

## Settled

- **One maintenance iteration pays all five.** Nothing a player sees changes:
  no version bump, no changelog section, no new file in the Portable package.
  The release workflow, the package layout, the updater and player-facing copy
  are untouched. The iteration is recorded as one `HISTORY.md` entry and rides
  along with the next release that has something to say. (#107, #114)
- **Every PR proves the shipped tree boots.** One script stages a built tree
  into a temporary root, starts the program on port 0 with the browser
  suppressed, reads the page URL the program prints (which carries the boot
  token), and drives the program through the page's own API only: the status
  route with the token, the instance record on disk, the exit route. Every
  request goes through the token guard, because a smoke that bypasses the guard
  proves the wrong thing. It exits non-zero on the first disagreement and prints
  which one, with no network and no real Run. (#108)
- **Two cases, one script.** A complete tree boots and answers; a tree with one
  artifact removed refuses to boot with the boot refusal and a non-zero code.
  The second case is the reason the script exists in CI at all: the refusal is a
  rule only the artifact can demonstrate. (#108)
- **CI gains two steps, not a job.** Build the program, then boot it, inside the
  existing required check, after the tests — branch protection already expects
  one required check, and a second job would have to be added to it. Windows-only
  surfaces (the launchers, the updater, the junction layout) stay uncovered by
  design and are named as a limit in the script's own comment. (#108)
- **The boot check is a script, not a unit test.** It needs a real process, a
  real socket and a temporary application root — the boundary the unit tests
  deliberately stop at — so it is a command in the command table and a CI step,
  and `pnpm test` stays fast and hermetic. (#108)
- **The boot check lands before, or with, the steering-file trim.** The
  bundler-banner lesson is the strongest argument for the CI boot; once the boot
  exists, that paragraph is genuinely reference. No state may exist where
  neither the document nor a check carries it. (#107)
- **A worktree runs `pnpm` on the first try.** The pre-script dependency install
  is turned off in the workspace settings, with the comment that names the
  junction and the 53 failures that motivated it. The check's real purpose — a
  lockfile that disagrees with the manifest — stays where it is enforced: the
  frozen install in CI. The fix is a setting, not a ritual, so nothing depends
  on an agent remembering an environment variable. (#110)
- **A design session leaves a note, and the note has four fixed parts**: the
  question, the settled branches, the open branches, and the rejected branches
  with their reasons. It lives in `docs/notes/`, one file per topic, and the
  convention is `docs/agents/design-notes.md`, beside the other agent pointers.
  The grilling skill gains
  the matching completion criterion, so the convention has a trigger and not
  just a home. The two ship together: a notes directory nobody is told to write
  is a folder, and a completion criterion with no home is a rule with no index.
  (#111)
- **The ADR index is hand-written, one line per decision**: number, slug, and
  the decision in one clause, in one consistent order. It is not generated from
  the ADR bodies or from frontmatter, because the clause is a summary and a
  generator would either copy the title or tempt a second format into the files.
  A test over the real `docs/adr/` directory guards it in both directions —
  every ADR file has a line, and every line names a file that exists — because
  without the test the index is the next thing to rot. (#109)
- **The steering file keeps what a first command needs and points at the
  rest.** The package-manager version policy and the build allow-list stay
  always-on, because they bite during a first install. The bundler banner, the
  launcher's encoding, the manual's encoding, the line-ending rule, the
  synchronous Run log and the hooks paragraph move behind one pointer whose
  wording leads with the branches that open it — packaging, build, Console boot,
  Run log — so it fires before the work that needs it. The formatter's rules
  stop being restated, because its configuration file is the source of truth.
  The command table gains three rows: the inspection tool that satisfies the
  edit guard, the one way to run a one-off snippet under the sandbox, and the
  search that exists on this machine. (#113)
- **A retired vocabulary fails CI.** The guard derives its list from the
  contract's source — the exported runtime tuple literals in
  `web/api-types.ts` — not from a hand-maintained second list, and requires each
  one to be either enumerated by the dictionary test or named in an explicit
  exemption with a reason. Asserting the exemption rather than the absence keeps
  deleting a tuple and deleting its copy two deliberate edits. (#112)
- **The tickets are vertical and independently verifiable**: boot (#108), ADR
  index (#109), worktree setting (#110), design notes (#111), vocabulary guard
  (#112), steering-file trim (#113), history entry (#114). (#107)

## Open

- **The worktree setting is not proven locally.** A quiet probe — fresh
  worktree, junctioned `node_modules`, a forced dependency check, a changed
  manifest — did not reproduce the failure, which means it needs the parallel
  fan-out that produced it. Verify on the next fan-out: no
  `installing dependencies` line should appear in any script run. If the setting
  does not take, the fallback is one `pnpm install --ignore-scripts` per worktree
  at creation time — slower but unarguable. (#110)
- **The grilling skill lives outside this repository.** Its completion criterion
  therefore has one step no reviewer in this repository can gate; the history
  entry records it instead of a test. (#111, #114)
- **Windows-only surfaces remain uncovered.** The launchers (`启动.bat`,
  `更新.bat`), the updater, the junction layout and the manual's rendering are
  checked by hand on a real Chinese Windows 11, not by CI; the boot script's
  comment names this limit. (#108)
- **The steering-file trim is verified behaviourally, not mechanically.** The
  next fan-out has to show no pre-script install and a fresh agent still
  reaching the packaging rules through the pointer. Until that fan-out runs, the
  trim is a claim. (#113)
- **A design note has no gate.** Nothing tests prose; the only check is a fresh
  reader starting from the note, as this note itself was checked. If notes rot,
  a session finds out the way #107's sessions did — by re-reading and finding
  the note wrong. (#111)

## Rejected

- **A pointer-existence test for every link in the steering file.** Rejected: a
  link that resolves is not evidence a reader follows it. The failure #107
  measured was an agent never opening the branch-specific document, and the
  spec's verification is behavioural — the next fan-out finds the packaging
  rules through the pointer. A link test would pin the prose's shape and pass
  while the trigger it exists for failed. (#113)
- **An ADR index generated from the ADR bodies or from frontmatter.** Rejected:
  the clause is a summary, so a generator would either copy the title or tempt a
  second format into the ADR files; either way the index stops being a lookup
  and becomes a second copy of the decisions. (#109)
- **Merging the vocabulary guard into the ADR index test.** Rejected: the two
  read different subjects — Markdown files under `docs/adr/` versus exported
  runtime tuples in `web/api-types.ts` — and fail for different reasons. One
  test with two invariants makes a red build ambiguous and lets one invariant rot
  behind the other. They stay two scanning tests at their own seams. (#109,
  #112)
- **The boot check as a unit test.** Rejected: it needs a real process, a real
  socket and a temporary application root, and moving it lower loses the only
  thing it tests — the bundling and boot seam. The prior art for the style is
  the existing bound-service tests, which drive a real listener rather than
  mocking the transport. (#108)
- **A second CI job for the boot check.** Rejected: branch protection expects
  one required check, so a job would have to be added to it; two steps inside
  the existing check cost nothing and need no settings change. (#108)
- **The worktree fix as a remembered ritual.** Rejected: the `npm_config_*`
  prefix was re-invented by six agents in one fan-out, and the sentence
  explaining it lived in a prompt. A setting is enforced by the tool; a ritual
  is remembered or lost. (#110)
- **Installing a search binary, or changing any CI workflow other than by
  adding the two boot steps.** Rejected as out of scope: the notes directory
  plus `gh issue list` is the lookup, and the boot steps join the existing
  check. (#107)
- **Deleting, splitting or indexing `HISTORY.md`.** Rejected as out of scope:
  no session had to fight it. (#107)
- **Changing the grilling skill's questioning technique.** Rejected: it gains a
  completion criterion, nothing else; the rounds, the frontier and the format
  stay as they are. (#107)
