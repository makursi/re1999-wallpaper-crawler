# AGENTS.md

## Project identity

Wallpaper scraper for [Bluepoch](https://re.bluepoch.com). A Run asks the site's
own Gallery list for every Wallpaper URL in one unauthenticated request, then
downloads them in parallel. There is no browser in the pipeline: no Chrome, no
`@playwright/cli`, no session (ADR 0018).

## Prerequisites

**Installing the release takes one thing: Node.** The release is a flat
directory — unzip it, run `npm install` once and `npm start` — and `README.md` is
its one document. The zip ships no runtime, no launcher and no manual; the Node
floor is enforced both by npm's `engine-strict` at install time and by the
program's first Chinese sentence (#117).

**Working in this repository** takes Node 22 and pnpm, then `pnpm install` for
project dependencies. A worktree's `node_modules` is a junction onto the parent
checkout: never run `pnpm install` there, and `verifyDepsBeforeRun: false` in
`pnpm-workspace.yaml` means its scripts install nothing. When a `pnpm` script
fails with `vitest` (or another bin) not recognised, the parent's store or bin
links are broken, not the worktree — the junction only exposes what the parent
owns — so run `pnpm install --frozen-lockfile --force` in the parent checkout
and leave the worktree alone. A source Run needs one line in `.env` —
`BASE_ORIGIN=https://re.bluepoch.com` — and the Console's setup notice says so
when it is missing. `pnpm webui` runs the built program in `build/` but points
the data root at the repository's `data/` (`scripts/webui.ts`), so your Mirror
and Run logs are the ones the page shows: the released root's own `data\\`
child, reproduced. `pnpm build` recreates `build/`; the development commands
and that caveat live in this file, and the product `README.md` only points here
rather than carrying a second copy. Before editing `README.md` or `README.en.md`,
read `docs/readme-styleguide.md`: it is the standard the change is held to.

## Commands

| Task | Command |
|------|---------|
| Scrape wallpapers | `pnpm core:run` (`tsx core/main.ts`) |
| Check the newest Run | `pnpm check-run` (`tsx core/check-run.ts`) |
| Build the program | `pnpm build` (`tsx scripts/build.ts` → `build/`; needed before `webui`) |
| Boot the built tree | `pnpm smoke:boot` (scope and limits: `docs/agents/branch-reference.md`) |
| Package the release | `pnpm package` (`pnpm build` + `tsx scripts/package.ts` → `dist-package/re1999-wallpaper-crawler-v<version>.zip`; needs the npm registry for the generated lockfile) |
| Check the packaged release | `pnpm package:check` (`tsx scripts/package-check.ts`; release-only and needs the registry — extracts the newest `dist-package/…zip`, `npm install`s it, boots it with `npm start` and probes `/api/status`: proves the shipped manifest, the generated lockfile, `.npmrc` and a real native `sharp` install) |
| WebUI (local page) | `pnpm webui` (`tsx scripts/webui.ts` — build/ as the program, the repository's data/ as its data; flags `--port`, `--no-open`) |
| Build the page only | `pnpm build:web` (`vite build --config web/vite.config.ts`) |
| Tests | `pnpm test` (`vitest run`) |
| Typecheck | `pnpm typecheck` (`tsc --noEmit` + `vue-tsc --noEmit -p web/tsconfig.web.json`) |
| Lint | `pnpm lint` (`oxlint --type-aware .`) |
| Format | `pnpm fmt` / `pnpm fmt:check` (`oxfmt`) |

Three facts about working in this shell, not project commands:

- **Inspect a file** with the harness's `read <path>` tool, not `cat`/`Get-Content`: the edit guard counts the read tool's observation, so a shell read costs a step — the file must be read again before the next edit
- **Run a one-off snippet** by writing it to a file and running it — `node <file>.mjs`, or `pnpm exec tsx <file>.ts`; do not capture a spawned child's output through a pipe (`spawn`/`exec` default stdio): under the sandbox that pipe is refused with `EPERM`
- **Search the tree** with the harness's grep tool, or `git grep -n <pattern>` in this shell: `rg` is not installed on this machine, and PowerShell has no `grep`

`pnpm build` writes `build/` — `server.js`, `run.js`, `package.json` and
`web/dist/` — and that tree is the program: it runs through `npm start` with no
`tsx` and no `vite` on the machine, and `build/` is a complete application root
(`node build/server.js` finds its `.env`, its page and its Run entry where
`web/server/build-artifacts.ts` says they are). `build/` is gitignored; a
fresh checkout has to be built once, and the Console refuses to boot without the
artifacts rather than compiling them on the owner's first click (#84).

CI (`.github/workflows/ci.yml`) runs `fmt:check`, `lint`, `typecheck`, the page
bundle build and `test` on every PR and on pushes to `main`, then builds the
program and boots it (`pnpm build`, then `pnpm smoke:boot`): both entries
compile and the Console boots on every PR instead of first on a tag.
`.github/workflows/autofix.yml` runs
`pnpm lint:fix && pnpm fmt` on PRs and commits the result back to the branch, so
a PR does not have to be formatted by hand — it needs the
[autofix.ci App](https://github.com/apps/autofix-ci) installed on the repo.

## Releasing

A release is a tag and then a human decision. `git tag vX.Y.Z && git push
origin vX.Y.Z` runs `.github/workflows/release.yml` on **windows-latest**: it
checks the tag against `package.json` (`scripts/release-tag.ts`), cuts the
matching section out of `CHANGELOG.md` (`scripts/release-notes.ts`), runs the
same gates CI runs, packages the flat zip, installs and boots that archive
(`pnpm package:check`), and only then creates a **draft** GitHub Release named
for the tag with the extracted notes as its body. It never publishes, and
`workflow_dispatch` is the dry run that builds everything, package check
included, but creates no Release.

`CHANGELOG.md` is the one user-readable record — Chinese, plain language, with
its extraction rule stated in its own header: each version is exactly
`## X.Y.Z`, and its body runs to the next `## ` heading. The section is an
instance of the template that header states — up to seven `###` sections in a
fixed order (新增 / 变更 / 修复 / 破坏性变更 / 安装 / 升级说明 / 下载文件, only
the applicable ones written), no preamble line, no personal pronouns — and
`scripts/release-notes.ts` refuses a body whose headings, order, empty sections,
archive name or pronouns break it before anything is built, while `pnpm test`
runs the same check over the version `package.json` names (ADR 0023). Bump
`package.json`, write that section, commit, then tag. The draft Release is where
the maintainer downloads the zip, extracts it on a Windows machine that has Node
but no checkout, runs `npm install` and `npm start`, checks the page, the version
and a thumbnail — and only then publishes the draft. A failed smoke test means
deleting the draft and the tag, not publishing a package nobody ran.

The version discipline is semver with one deliberate reading (ADR 0021, extended
by ADR 0024): **MAJOR** when the data layout, the configuration keys, or the way
the program is installed and updated stop being compatible, **MINOR** for a new
capability, **PATCH** for a fix — including a site redesign that broke the crawl.
The first public release is `1.0.0`; the flat npm-delivered shape is `2.0.0`.

## Git Conventions (every iteration)

All work lands on `main` only through a merged PR. **Never commit on `main`
(or `master`), and never touch a file before the branch exists** — the first
action of every iteration is step 1, not an edit.

This is enforced, not just asked: `simple-git-hooks` (configured in
`package.json`) runs `scripts/check-branch.mjs` on pre-commit, which refuses a
commit when HEAD is on `main`/`master` or detached, and then `lint-staged`
(`oxlint --fix --deny-warnings` on the staged files). The `prepare` script
installs the hooks — `pnpm install` runs it, and `pnpm prepare` re-runs it.

`git commit --no-verify` bypasses it — if you ever use it, say why in the PR.

Pre-push runs `pnpm typecheck && pnpm test`; that is a **subset** of CI, which
also runs `pnpm lint`. Push only after all three pass. **Before a pull request is
called ready, read CI's verdict for its head commit** (`gh pr checks <number>`):
the local gate is the subset, so a green local run says nothing about the page
bundle build, `pnpm build` and `pnpm smoke:boot` that CI also runs.

Every iteration ships via this exact flow, in order:

1. `git checkout -b <type>/<short-slug>` — type: `feat` / `fix` / `refactor` / `docs` / `chore`
   — **before** editing anything
2. Commit in English, conventional style (never Chinese in commit messages)
3. `git push -u origin <branch>`
4. `gh pr create --base main` (title = commit subject), then after review:
   `gh pr merge --squash --delete-branch`
5. `git checkout main && git pull`

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues, driven by the `gh` CLI (it infers the repo from `git remote`). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map 1:1 to `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: `CONTEXT-MAP.md` at the repo root names the contexts, whose
glossaries are sections of the single root `CONTEXT.md`, plus `docs/adr/` and
`HISTORY.md`. See `docs/agents/domain.md`.

A decision's subject finds its number in `docs/adr/README.md`: one line per ADR,
ascending by number, with the clause it decides.

Design notes are the third way a decision is recorded: a design or grill session
opens by looking for prior art in open issues and `docs/notes/`, and closes by
writing its decision tree to one note. See `docs/agents/design-notes.md`.

## Project history (read before changing pipeline internals)

`HISTORY.md` records **why the code is shaped the way it is** — each iteration's
trigger, decision (including rejected approaches), verification numbers, and
lessons. Scan it before modifying discovery/download internals or re-proposing
any approach listed there as rejected; it keeps prior dead ends from being
re-walked. It does not repeat current facts — those live above, in `core/` and
`web/`, and in `CONTEXT.md`; `docs/adr/` and the older entries are **dated**
decisions, quoting the paths of their day, and are deliberately not re-pointed
when the tree moves.

## Analyzing a run's logs

The Run-log reading reference has exactly one home: the runbook
`.agents/skills/save-images/SKILL.md`, step **"Verify — the Run report"** — the
log workflow, the field-by-field reading, every reading trap and the
optimization leads. This pointer is how a session that never loads the runbook
— one answering "was last night's Run clean?" — still reaches the rules.

One fact stays here because it is the one most often misread: **a missing
`run_report` is a defect in the log, not evidence that the Run failed** — an
exit code of 0 does not prove the report was written. The runbook's Verify step
carries the check that separates "the Run finished, the log is lost" from "the
Run never got there".

## Architecture

Open `docs/agents/architecture.md` before moving a module, before deciding which
file owns a rule, and before changing what the archive carries or where the data
lives: it holds the annotated tree — one line per module, with what it owns and
what is unit-tested — along with the licence agreement, the built tree, the
package layout and the data layout, and the standards review cites it as the
authority for module ownership.

## Standards review

The Standards axis of a review reads `CODING_STANDARDS.md`, its one source. It points at the code-style section below, the architecture document, the context map and glossary, and the ADRs rather than restating them, and it states the live-prose rule no guardrail can enforce.

## Gotchas

### 403 CDN retry

Download first attempt sends the UA and a Referer (the site origin). If 403,
retries once with the full browser headers (`Sec-Fetch-Dest`, `Sec-Fetch-Mode`,
`Sec-Fetch-Site`, `Accept`, `Accept-Language`). No session cookie is sent — the
CDN answers anonymously, so the retry is the CDN's header policy, not auth.

### The report's shape is a contract, even when a field stops varying

#76 re-pointed the report's capture fields at the list without dropping a key.
`discovery.coverage` is `1` or `null`, `siteAssets` and `discoveryLeak` are
always empty, and `siteAssetFalsePositive` is `{count: 0, urls: []}` whenever the
list was read — **not** `null`, because the run-log reader ties that `null` to
the Mirror gap's and would refuse every new report. A new report key also has to
be declared in `web/api-types.ts`; the `Same<>` checks in
`web/server/status.ts` make the compiler say so.

### pnpm 12 refuses just-published versions

`pnpm install` fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` when the
lockfile names a version published within the last 24h — a supply-chain guard
pnpm 12 applies by default. Pin the previous release (`oxlint@1.82.0`, not the
same-day `1.83.0`) rather than relaxing the policy.

### Build scripts need an allow-list

`pnpm-workspace.yaml` carries the `allowBuilds` list (`esbuild`,
`simple-git-hooks`). Without it `pnpm install` exits non-zero with
`ERR_PNPM_IGNORED_BUILDS`. pnpm 12 reads its settings from that file, **not**
from a `pnpm` field in `package.json` (which it now warns about and ignores).

## Branch-specific reference (packaging, build, Console boot, Run log)

**Packaging, build, Console boot or Run-log work** opens one document first:
`docs/agents/branch-reference.md`. It carries the four lessons that moved out of
this file — the `createRequire` bundling banner, the line-ending rule, the
synchronous Run log, and where the git hooks live — unchanged. A new lesson that
only one of those branches needs goes there, not here: this file keeps what a
first command needs.

## Code style

- Lint: **oxlint** (`pnpm lint` → `oxlint --type-aware .`), configured in
  `.oxlintrc.json`: the `correctness` category (error) and `suspicious` (warn),
  plus a handful of named rules. It replaced `@antfu/eslint-config` on
  2026-09-15 — see `HISTORY.md` for why, and for the rules deliberately kept
  (`eqeqeq` ignoring `!= null`, `import/no-unassigned-import` allowing
  `dotenv/config`, `virtual:uno.css` and the `@fontsource-variable/*` families —
  the virtual module *is* the stylesheet and a font import *is* its `@font-face`
  rules, so neither has a binding to assign).
- Format: **oxfmt** (`pnpm fmt` → `oxfmt`; `pnpm fmt:check` gates CI) — run it
  instead of hand-aligning. Its rules live in `.oxfmtrc.json`, which is their one
  source of truth and not a second statement here; `.editorconfig` states the
  editor defaults for the files oxfmt does not reach.
- TypeScript strict mode, ESM module system, run via `tsx` at **development**
  time (ADR 0003) — the shipped tree is a bundle (`pnpm build`), and nothing the
  owner runs loads a transpiler or a bundler
- The page's files sort by what they hold, not by feature: reactive state or a
  lifecycle belongs in `web/src/composables/`, a stateless pure function in
  `web/src/lib/`, markup only in `web/src/components/`. The entry and its views
  stay at `web/src/` (`App.vue` and the four view files) — they are what the page
  is, not parts of it; the buckets hold what they compose. A component may keep
  the view-model mapping only it renders (which dictionary key a state maps to);
  arithmetic or a rule another module also needs goes to `lib/`. Naming stays
  flat with a prefix (`Wall*`, `Run*`, `Console*`); there are no feature
  subdirectories, because one wall and one drawer would outnumber the code they
  organise.
- The service's transport is an adapter: it identifies the caller, gathers
  inputs and speaks HTTP (status codes, headers, bytes). A status code that
  reflects a domain state — a Run in flight, an Orphaned Run, a verdict — is
  decided by the module that owns the state (`status.ts`, `gallery-view.ts`,
  `run-control.ts`), never by a route; translating a request-level refusal
  (a malformed name, a missing file) is the route's, because `mirror-files.ts`
  names the refusal and HTTP is the vocabulary it is translated into. The
  response headers are hand-built in `web/server/http/respond.ts` — no router
  default serves a response a test asserts on (ADR 0017).
