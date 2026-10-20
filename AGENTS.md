# AGENTS.md

## Project identity

Wallpaper scraper for [Bluepoch](https://re.bluepoch.com) using **Playwright CLI** (`@playwright/cli`), _not_ Playwright Test or the Playwright library. It launches a real Chrome browser, clicks through a SPA page, captures image URLs from network traffic, and downloads them in parallel.

## Prerequisites

`@playwright/cli` must be installed globally:

```bash
npm install -g @playwright/cli
npx playwright-cli install
```

Then `pnpm install` for project dependencies.

## Commands

| Task | Command |
|------|---------|
| Scrape wallpapers | `pnpm core:run` (`tsx core/main.ts`) |
| Check the newest Run | `pnpm check-run` (`tsx core/check-run.ts`) |
| WebUI (local page) | `pnpm webui` (`tsx web/server/console.ts`, flags `--port`, `--no-open`) |
| Build the page only | `pnpm build:web` (`vite build --config web/vite.config.ts`) |
| Tests | `pnpm test` (`vitest run`) |
| Typecheck | `pnpm typecheck` (`tsc --noEmit` + `vue-tsc --noEmit -p web/tsconfig.web.json`) |
| Lint | `pnpm lint` (`oxlint --type-aware .`) |
| Format | `pnpm fmt` / `pnpm fmt:check` (`oxfmt`) |

CI (`.github/workflows/ci.yml`) runs `fmt:check`, `lint`, `typecheck`, the page
bundle build and `test` on every PR and on pushes to `main`. `.github/workflows/autofix.yml` runs
`pnpm lint:fix && pnpm fmt` on PRs and commits the result back to the branch, so
a PR does not have to be formatted by hand — it needs the
[autofix.ci App](https://github.com/apps/autofix-ci) installed on the repo.

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
also runs `pnpm lint`. Push only after all three pass.

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

Multi-context: `CONTEXT-MAP.md` at the repo root names the contexts, whose glossaries are sections of the single root `CONTEXT.md`, plus `docs/adr/` and `HISTORY.md`. See `docs/agents/domain.md`.

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

Two layers, one directory each at the root: `core/` is the crawler, `web/` is the Console. Nothing else at the root claims to be source — `scripts/` holds the run-code payload and the pre-commit guard.

```
core/                        — the crawler
├── config.ts                — the pipeline's eager configuration: parses .env at import (a broken file fails a Run before it starts) and exports the constants the pipeline imports
├── config-read.ts           — the configuration schema's one home: parseConfig (strict) + readConfig (the Console's non-throwing read), the tree-relative defaults, the Gallery list URL (unit-tested)
├── logger.ts                — pino: pretty console + synchronous JSONL Run log (ADR 0007)
├── main.ts                  — orchestration: clear session → open browser → run discovery → extract URLs → filter Site assets → download → check the list → report
├── check-run.ts             — the verdict CLI: newest Run log + Gallery state + file probe → print, exit 0/1
├── wallpaper-url.ts         — the Wallpaper URL set's vocabulary: isImageUrl, wallpaperNameOf, isWallpaperFile, Site asset rules, splitWallpaperUrls (unit-tested)
├── run-log-file.ts          — the newest Run log's name and the file probe, shared by check-run and the Console (unit-tested)
├── discovery/
│   └── discovery-loader.ts  — materializes the run-code payload into .run-cache/ (writes only when its content changed; never deleted) and reports its sha256 (unit-tested)
├── download/
│   └── download.ts          — parallel batch downloads via undici, cookie auth, 403 retry
├── gallery/
│   ├── gallery-source.ts    — the site's gallery list endpoint: fetch + validate (unit-tested)
│   └── gallery-state.ts     — cross-run id set + mirror check, writes images/.gallery-state.json (unit-tested)
└── report/
    ├── report.ts            — pure analysis: detectLeaks, classifyOutcomes, buildRunReport (unit-tested)
    └── run-log.ts           — the reverse: parseRunReport + assessRun, the three-state verdict (unit-tested)
web/                         — the Console, whole
├── index.html               — the page's entry document
├── api-types.ts             — the API contract the page and the service share: the payload types plus the code vocabularies (runtime tuples the dictionary test enumerates, ADR 0014)
├── uno.config.ts            — the design system: UnoCSS presets, semantic tokens, preflight (ADR 0013)
├── vite.config.ts           — the page's bundler config (root = this directory, output web/dist/)
├── tsconfig.web.json        — the page's type program (web/src/** + api-types.ts + uno.config.ts)
├── src/                     — the page (Vue 3): App.vue, the panels, the built-in token
│   ├── i18n/                — the typed dictionary, the locale switch, the refusal's wording (ADR 0014)
│   └── masonry.ts           — the wall's five-column distribution, a pure function (unit-tested)
└── server/                  — the service, and the one command that starts it
    ├── console.ts           — the entry point: build the page if absent, bind loopback, open it
    ├── server.ts            — loopback HTTP, token/Host/Origin guard, page + asset send
    ├── run-control.ts       — the Run launcher, the one-at-a-time rule, the stop decision
    ├── image-sizes.ts       — the Wallpapers' own pixel sizes, read for the masonry (unit-tested)
    └── …                    — the readers (Run log, Gallery list, Mirror, thumbnails)
tests/                       — mirrors the sources it tests
├── core/                    — the crawler's tests
│   ├── logger.test.ts
│   ├── config-read.test.ts
│   ├── discovery-loader.test.ts
│   ├── wallpaper-url.test.ts
│   ├── run-log-file.test.ts
│   ├── gallery/
│   │   ├── gallery-source.test.ts
│   │   └── gallery-state.test.ts
│   └── report/
│       ├── report.test.ts
│       └── run-log.test.ts
└── web/                     — the Console's tests
    ├── server/              — the service's tests (and their two helpers)
    └── src/                 — the page's tests
        ├── masonry.test.ts
        └── i18n/
            └── messages.test.ts
.run-cache/                  — the Discovery script copy a Run materializes for `run-code --filename` (gitignored; written only when its content changed, never deleted)
scripts/
├── run-discovery.js  — Playwright CLI run-code script (async (page) => { ... })
└── check-branch.mjs  — pre-commit guard: refuse to commit on the default branch
```

A Run's data stays at the repository root, because both layers read it: the Mirror (`images/`) and the Run log directory (`logs/`). Everything the Console owns travels with it — the built page (`web/dist/`) and the thumbnail cache (`web/.console-cache/`, outside the Mirror by ADR 0010). `.run-cache/` is the one root directory only the crawler reads: `run-code --filename` can only be handed a file, so a Run materializes the Discovery script copy there — written only when its content differs from what is on disk, and never deleted.

Tests mirror the source tree under `tests/` (`core/report/report.ts` → `tests/core/report/report.test.ts`, `web/server/server.ts` → `tests/web/server/server.test.ts`, `web/src/masonry.ts` → `tests/web/src/masonry.test.ts`); `vitest.config.ts` scopes collection to `tests/**/*.test.ts`, so a test file left in a source tree never runs.

**Network-first design**: image URLs are captured via `page.on("response")` listening for `content-type: image/*`, _not_ from DOM scanning. DOM is only used to drive scrolling/clicking to trigger lazy loads.

**The gallery list is the authority** (ADR 0006): the site's own list endpoint
returns every entry in one unauthenticated request, and it is what makes
`gallery.officialTotal` exact, the new-vs-known delta id-keyed, and the Site
asset filter checkable. Download still consumes the browser capture — read the
discovery-coverage open question in HISTORY.md before assuming that stays true.

## Gotchas

### Playwright CLI, not Playwright

Commands use `npx playwright-cli -s=<session>` (CLI tool), not `npx playwright test` or `import { chromium } from 'playwright'`. The CLI manages a persistent browser session by name (default: `bluepoch`).

### Windows: run-code uses --filename, never inline

cmd.exe mangles multi-line strings with `#` and quotes, so the payload never
travels as a CLI argument: `core/discovery/discovery-loader.ts` materializes it
into `.run-cache/run-discovery.generated.js` and `--filename` points there. The
copy is compared before it is written, so a Run whose payload and page hash are
unchanged writes nothing, and nothing is ever deleted. A `--filename` target
must also sit inside the CLI's allowed roots — its output directory or its
working directory — which `.run-cache/` does and the OS temp directory does not
(reaching `%TEMP%` works only because the CLI hardcodes its skill mode). Never
pass inline code via CLI arguments. Because the copy is materialized before the
Run log's first record, a payload that cannot be materialized fails with no Run
log at all — by design, since the Run never started.

### run-code context is Node.js, not browser

The function passed to `playwright-cli run-code` runs in Node.js and receives a Playwright `page` object. Browser APIs (`window`, `document`) only work inside `page.evaluate()`.

### .env hash trap

`#` is a comment character in `.env` (dotenv). The page hash `#wallpaper` is hardcoded in `core/config.ts`, not read from `.env`.

### Viewport matters

The target site renders different layouts based on viewport. The Playwright config uses `viewport: null` + `--window-size=1920,1080` so the real window size determines the viewport, ensuring the desktop version loads.

### 403 CDN retry

Download first attempt uses cookies + UA + Referer. If 403, retries with full browser headers (`Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Sec-Fetch-Site`, `Accept`).

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

### Git history is LF, the Windows worktree is CRLF

The repository stores LF; `core.autocrlf=true` only makes Windows checkouts
CRLF, and `.gitattributes` (`* text=auto eol=lf`) now pins the worktree to LF so
the formatter, CI and the checkout agree.

**Do not judge line endings from text output.** `git cat-file` runs the smudge
filter when it prints a blob, so `git cat-file blob <sha> | grep -c $'\r'`
reports CRLF for content that is stored as LF — and in this shell `grep -c $'\r'`
silently degrades to counting *lines* (it returns the line count for both CRLF
and LF input). Compare **sizes** instead:

```sh
sha=$(git rev-parse HEAD:core/main.ts)
git cat-file --batch-check='%(objectsize)' <<< "$sha"   # vs wc -c on the file
```

A blob smaller than its file by roughly one byte per line is LF.

### The run-code script is a protocol payload, not ordinary source

`scripts/run-discovery.js` is read from disk and handed to
`playwright-cli run-code --filename=…`, which evaluates it as
`(\n<file contents>\n)(page);`. Its **exact** shape is therefore load-bearing:
the file must stay a bare `async (page) => { … }` expression. Consequences:

- It is excluded from **oxfmt** (`.oxfmtrc.json`): the formatter inserts a
  protective leading `;` before a bare expression statement, and
  `(;async (page) => …)(page)` is a `SyntaxError: Unexpected token ';'` — the
  whole crawl then discovers nothing. Proven against a live session; do not
  re-try this by "just formatting it once".
- It is excluded from **oxlint** (`.oxlintrc.json`) as well, and not for a style
  reason: the file *is* a bare expression statement, so `no-unused-expressions`
  fires on line 1 as an unfixable error (measured: read-only lint reports 1
  error + 5 warnings, `oxlint --fix` changes nothing and still exits 1). Since
  `lint-staged` runs `--deny-warnings`, that would block every commit touching
  the file, and silencing it would need either a disable comment or a rule
exception — neither worth it for a file no tool may rewrite anyway.
- lint-staged calls both tools with `--no-error-on-unmatched-pattern`, so
  committing a change to this file is not blocked by them having nothing to do.
- **Verify an edit the way the payload is consumed**, not by `node --check` on the
  file alone: write `(` + newline + the file + newline + `)(page);` to a scratch
  file and check *that*, because the wrapper is what catches the known failure
  mode (a leading `;`). A comment-only change is proven by the wrapper check;
  anything that touches the expression itself — a statement, a name, a
  control-flow path — is proven by running the scraper, since a crawl that
  discovers nothing looks exactly like a site with nothing new.

### The Run log is written synchronously, and must stay that way

`core/logger.ts` writes the JSONL Run log through `pino.destination({ sync: true })`
on the main thread, with `pino-pretty` as a plain stream rather than a second
`transport` target. That costs one blocking write per record and buys the one
property the log exists for: a transport puts the file sink in a worker thread,
and a worker that stops leaves the process logging into a dead channel while
still exiting 0 — which is how Run `2026-09-15T09-36-50` lost its `run_report`
(ADR 0007). The file sink also keeps the **lower level** of the two sinks,
because pino's multistream writes in level order and has no error isolation: the
record has to reach the file before a console stream that throws can eat it
(pino sorts the streams by level in `add()`, so the order of the array in the
source is decoration, not the mechanism — raising the file's level above the
console's is what would invert it). Do not "optimize" this back into a
transport.

### Git hooks live in `.git/hooks`, and `core.hooksPath` must stay unset

`simple-git-hooks` writes `.git/hooks/*` from the `prepare` script. A leftover
`git config core.hooksPath .githooks` (the removed shell-hook setup) points at a
deleted directory and makes git skip hooks **silently** — clear it with
`git config --unset core.hooksPath`. Verify the hooks actually fire by trying a
commit on `main`: it must be refused.

## Code style

- Lint: **oxlint** (`pnpm lint` → `oxlint --type-aware .`), configured in
  `.oxlintrc.json`: the `correctness` category (error) and `suspicious` (warn),
  plus a handful of named rules. It replaced `@antfu/eslint-config` on
  2026-09-15 — see `HISTORY.md` for why, and for the rules deliberately kept
  (`eqeqeq` ignoring `!= null`, `import/no-unassigned-import` allowing
  `dotenv/config`, `virtual:uno.css` and the `@fontsource-variable/*` families —
  the virtual module *is* the stylesheet and a font import *is* its `@font-face`
  rules, so neither has a binding to assign). `scripts/run-discovery.js` is the
  one deliberate exclusion, for the reason above.
- Format: **oxfmt** (`pnpm fmt` → `oxfmt`, `pnpm fmt:check` gates CI), configured
  in `.oxfmtrc.json`: no semicolons, single quotes, no parens on a sole arrow
  parameter, 100 columns, LF, sorted imports. Markdown is not formatted yet, and
  neither is the run-code payload. Formatting is not a matter of taste here —
  run `pnpm fmt` instead of hand-aligning.
- TypeScript strict mode, ESM module system, run via `tsx` (ADR 0003)
- Formatting: semicolons off, single quotes, 2-space indent, LF — enforced by
  oxfmt, not hand-maintained (`.editorconfig` still states the editor defaults
  for files outside its reach).
