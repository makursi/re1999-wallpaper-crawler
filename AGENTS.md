# AGENTS.md

## Project identity

Wallpaper scraper for [Bluepoch](https://re.bluepoch.com). A Run asks the site's
own Gallery list for every Wallpaper URL in one unauthenticated request, then
downloads them in parallel. There is no browser in the pipeline: no Chrome, no
`@playwright/cli`, no session (ADR 0018).

## Prerequisites

**Players install nothing.** The portable release ships its own Node runtime and
a prebuilt page; the user-facing path is the download in `README.md` and the
manual inside the package, `packaging/使用说明.txt` (#89) — never a terminal, and
never `pnpm install`.

**Developers and agents** need Node 22 and pnpm, then `pnpm install` for project
dependencies. A worktree's `node_modules` is a junction onto the parent checkout: never run `pnpm install` there, and `verifyDepsBeforeRun: false` in `pnpm-workspace.yaml` means its scripts install nothing. A source Run needs one line in `.env` —
`BASE_ORIGIN=https://re.bluepoch.com` — and the Console's setup notice says so
when it is missing. `pnpm webui` runs the built program in `build/` but points the data root at the repository's `data/` (`scripts/webui.ts`), so the developer's Mirror and Run logs are the ones the page shows: the packaged shape's `app\\` beside `data\\`, reproduced. `pnpm build` recreates
`build/`, and the README's developer section says so rather than implying the
repository's `.env` is used.

## Commands

| Task | Command |
|------|---------|
| Scrape wallpapers | `pnpm core:run` (`tsx core/main.ts`) |
| Check the newest Run | `pnpm check-run` (`tsx core/check-run.ts`) |
| Build the program | `pnpm build` (`tsx scripts/build.ts` → `build/`; needed before `webui`) |
| Boot the built tree | `pnpm smoke:boot` (`tsx scripts/smoke-boot.ts` — stages `build/` into a temporary root, starts it with the browser suppressed, drives `/api/status` and `/api/exit` with the boot token, and proves a tree missing `run.js` refuses; needs no network, `.env` or real Run; CI runs it after `pnpm build`) |
| Package the portable release | `pnpm package` (`pnpm build` + `tsx scripts/package.ts` → `dist-package/re1999-wallpaper-crawler-v<version>.zip`) |
| WebUI (local page) | `pnpm webui` (`tsx scripts/webui.ts` — build/ as the program, the repository's data/ as its data; flags `--port`, `--no-open`) |
| Build the page only | `pnpm build:web` (`vite build --config web/vite.config.ts`) |
| Tests | `pnpm test` (`vitest run`) |
| Typecheck | `pnpm typecheck` (`tsc --noEmit` + `vue-tsc --noEmit -p web/tsconfig.web.json`) |
| Lint | `pnpm lint` (`oxlint --type-aware .`) |
| Format | `pnpm fmt` / `pnpm fmt:check` (`oxfmt`) |
| Inspect a file | the harness's `read <path>` tool, not `cat`/`Get-Content`: the edit guard counts the read tool's observation, so a shell read costs a step — the file must be read again before the next edit |
| Run a one-off snippet | write it to a file and run it — `node <file>.mjs`, or `pnpm exec tsx <file>.ts`; do not capture a spawned child's output through a pipe (`spawn`/`exec` default stdio): under the sandbox that pipe is refused with `EPERM` |
| Search the tree | the harness's grep tool, or `git grep -n <pattern>` in this shell: `rg` is not installed on this machine, and PowerShell has no `grep` |

`pnpm build` writes `build/` — `server.js`, `run.js`, `update.js`, `package.json`
and `web/dist/` — and that tree is the program: it runs with no `node_modules`,
no `tsx` and no `vite` on the machine, and `build/` is a complete application
root (`node build/server.js` finds its `.env`, its page and its Run entry where
`web/server/build-artifacts.ts` says they are). `build/` is gitignored; a
fresh checkout has to be built once, and the Console refuses to boot without the
artifacts rather than compiling them on the owner's first click (#84).

CI (`.github/workflows/ci.yml`) runs `fmt:check`, `lint`, `typecheck`, the page
bundle build and `test` on every PR and on pushes to `main`, then builds the
program and boots it (`pnpm build`, then `pnpm smoke:boot`), so the three entries
compile and the shipped tree answers on every PR instead of first on a tag.
`.github/workflows/autofix.yml` runs
`pnpm lint:fix && pnpm fmt` on PRs and commits the result back to the branch, so
a PR does not have to be formatted by hand — it needs the
[autofix.ci App](https://github.com/apps/autofix-ci) installed on the repo.

## Releasing

A release is a tag and then a human decision. `git tag vX.Y.Z && git push
origin vX.Y.Z` runs `.github/workflows/release.yml` on **windows-latest**: it
checks the tag against `package.json` (`scripts/release-tag.ts`), cuts the
matching section out of `CHANGELOG.md` (`scripts/release-notes.ts`), runs the
same gates CI runs, packages the zip with the runner's own `node.exe` through
`RE1999_NODE_EXE`, and creates a **draft** GitHub Release named for the tag with
the extracted notes as its body. It never publishes, and `workflow_dispatch` is
the dry run that builds everything but creates no Release.

`CHANGELOG.md` is the one user-readable record — Chinese, player-facing, with
its extraction rule stated in its own header: each version is exactly
`## X.Y.Z`, and its body runs to the next `## ` heading. The section is an
instance of the template that header states — up to seven `###` sections in a
fixed order (新增 / 变更 / 修复 / 破坏性变更 / 安装 / 升级说明 / 下载文件, only
the applicable ones written), no preamble line, no personal pronouns — and
`scripts/release-notes.ts` refuses a body whose headings, order, empty sections,
archive name or pronouns break it before anything is built, while `pnpm test`
runs the same check over the version `package.json` names (ADR 0023). Bump
`package.json`, write that section, commit, then tag. The draft Release is where
the maintainer downloads the zip, extracts it on a clean Windows machine without
Node or pnpm, double-clicks `启动.bat`, checks the page, the version and a
thumbnail — and only then publishes the draft. A failed smoke test means
deleting the draft and the tag, not publishing a package nobody ran.

The version discipline is semver with one deliberate reading (ADR 0021):
**MAJOR** when the data layout or the configuration keys stop being compatible,
**MINOR** for a new capability, **PATCH** for a fix — including a site redesign
that broke the crawl. The first public release is `1.0.0`.

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

A decision's subject finds its number in `docs/adr/README.md`: one line per ADR, ascending by number, with the clause it decides.

Design notes are the third way a decision is recorded: a design or grill session opens by looking for prior art in open issues and `docs/notes/`, and closes by writing its decision tree — the question, the settled branches, the open branches, and the rejected branches with their reasons — to one note. See `docs/agents/design-notes.md`.

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

Two layers, one directory each at the root: `core/` is the crawler, `web/` is the Console. Nothing else at the root claims to be source — `scripts/` holds the pre-commit guard, the build and the packager, and `packaging/` holds what the portable package places at its archive root (`启动.bat` #85, `更新.bat` #87, `使用说明.txt` #89) plus the site-constants template that becomes `app\.env`.

```
core/                        — the crawler
├── app-root.ts              — the two injected roots: RE1999_APP_ROOT / RE1999_DATA_ROOT or their caller fallbacks; nothing derives either from module position (unit-tested)
├── config.ts                — the pipeline's eager configuration: reads the two layers at import (an unusable pair fails a Run before it starts) and exports the constants the pipeline imports
├── config-read.ts           — the configuration schema's one home: parseConfig (strict) + readLayeredConfig (the Console's non-throwing read; app/.env over defaults, data/user.env over app), the data-relative defaults, the Gallery list URL, and the User-Agent default (no eager parse; re-exported by config.ts) (unit-tested)
├── data-layout.ts           — the arrangement inside the data directory: images/, logs/, cache/thumbnails/, the layout.json version marker, and the forward-only same-volume rename of a pre-#80 checkout (unit-tested; never deletes)
├── version.ts               — the one current version: the build-injected constant (`RE1999_VERSION`, ticket #84's define seam) with the app root's package metadata as the source run's fallback (unit-tested)
├── logger.ts                — pino: pretty console + synchronous JSONL Run log (ADR 0007)
├── main.ts                  — orchestration: ask the gallery list → download its URLs → check the list → report
├── check-run.ts             — the verdict CLI: newest Run log + Gallery state + file probe → print, exit 0/1
├── wallpaper-url.ts         — the Wallpaper URL set's vocabulary: isImageUrl, wallpaperNameOf, isWallpaperFile, Site asset rules, splitWallpaperUrls (unit-tested; the rules are vocabulary now, off the Run's path — ADR 0018)
├── run-log-file.ts          — the newest Run log's name and the file probe, shared by check-run and the Console (unit-tested)
├── discovery/
│   └── discovery.ts         — Discovery: turns the Gallery list into the Run's URL set and the report's counters/capture audit (the list request itself stays in gallery-source.ts; unit-tested)
├── download/
│   └── download.ts          — parallel batch downloads via undici (injected client and site inputs), no session, 403 retry (unit-tested)
├── gallery/
│   ├── gallery-source.ts    — the site's gallery list endpoint: fetch + validate (unit-tested)
│   └── gallery-state.ts     — cross-run id set + mirror check, writes <data>/images/.gallery-state.json (unit-tested)
└── report/
    ├── report.ts            — pure analysis: detectLeaks, classifyOutcomes, buildRunReport (unit-tested)
    └── run-log.ts           — the reverse: parseRunReport + assessRun, the three-state verdict (unit-tested)
web/                         — the Console, whole
├── index.html               — the page's entry document
├── api-types.ts             — the API contract the page and the service share: the payload types plus the code vocabularies (runtime tuples the dictionary test enumerates, ADR 0014)
├── uno.config.ts            — the design system: UnoCSS presets, semantic tokens, preflight (ADR 0013)
├── vite.config.ts           — the page's bundler config (root = this directory, output web/dist/)
├── tsconfig.web.json        — the page's type program (web/src/** + api-types.ts + uno.config.ts)
├── src/                     — the page (Vue 3). The entry and its views stay at this level — `App.vue`, `GalleryView.vue`, `RunPanel.vue`, `OrphanPanel.vue`, `FullSizeView.vue` — because they are what the page is; everything they compose lives in three buckets, one rule: reactive state or a lifecycle → `composables/`; a stateless pure function → `lib/`; markup only → `components/`
│   ├── components/          — markup only; flat, prefixed names; no feature subdirectories: `ConsoleNav` + `ConsoleUpdateNotice` + `LocaleSwitch` + `ConsoleDrawer` (the shell — the Exit lives on the nav, #96), `WallStart` + `WallHeader` + `WallTile` (the wall), `GalleryFigures` (the one figures line, rendered by both the header and the panel, #94), `RunSetupNotice` + `RunVerdict` (the Run panel)
│   ├── composables/         — the page's shared state: `useConsoleStatus` (one status read, the Run poll, the read on window focus), `useGallery` (the wall's one read — the page's one gallery snapshot), `usePageExit` (the page's one exit: exiting / awaiting confirmation / exited, #96), `useRunStart` (the page's one start action — only a click starts a Run)
│   ├── lib/                — stateless: `console-api.ts` (the only place a request carries the token), `masonry.ts` (the wall's columns — unit-tested), `poll.ts` (whether to read again), `gallery-figures.ts` (the one figures line: Gallery / downloaded / missing / extra — unit-tested), `run-panel.ts` (the counts line and the panel's one problem line, by priority — unit-tested), `wall-state.ts` (which band the wall is in, decided by the Mirror gap's missing count) + `run-start.ts` (what the start control is called — both unit-tested)
│   ├── i18n/                — the typed dictionary, the locale switch, the refusal's wording (ADR 0014)
│   └── console-token.ts     — the token the page was opened with, read from its own URL
└── server/                  — the service, and the one command that starts it
    ├── console.ts           — the entry point: resolve the app root, read the layers, refuse a tree missing its build artifacts, bind loopback, open it; also the process lifecycle — the page's exit and the terminal signal share one shutdown (say the Chinese, close, `exit 0`), and the exit copy is here (#96)
    ├── build-artifacts.ts   — what the shipped tree is made of: server.js / run.js / update.js / web/dist/index.html, the Run entry's path, and the boot refusal for a tree that lacks one (unit-tested; #84, #87)
    ├── server.ts            — the app: the guard, the routes, the port fallback; re-exports the dependency contract from `http/deps.ts` so the contract keeps its import address
    ├── http/                — the transport's own parts: `deps.ts` (the injected contract), `guard.ts` (token/Host/Origin), `respond.ts` (the four response shapes and their exact headers), `method.ts` (405 + `allow`), `content-types.ts` (the extension→type table both the assets and the image routes read), `token-rewrite.ts` (the page and stylesheet rewrites), `assets.ts` (containment + serving one built asset)
    ├── routes/              — one file per route group (status, gallery, images, run, exit, instance, static); a route gathers inputs and translates a request-level refusal, but invents no status for a domain state
    ├── run-control.ts       — the Run launcher, the one-at-a-time rule, the stop decision, and the page's exit: `exitDecisionOf` (the same `stopDecision`, the caller's confirmation folded in) and `createExitController` (the kill of this Console's own tree, the scheduled shutdown) (#96)
    ├── instance-record.ts   — the handshake's file: the bound port + this boot's token in `<data>/instance.json`, its shape version and its ownership check (unit-tested; #82)
    ├── instance-handshake.ts — the second double-click's question: ask the record's address whether that service still answers, and hand back its page URL or `null` (socket-tested; #82)
    ├── installation.ts      — where the package is installed (`<install>\app` beside `<install>\data`), and the `%LOCALAPPDATA%` pointer the updater reads (unit-tested; #85)
    ├── updater.ts           — the update's one home: resolve the installation (pointer, or the dragged path), refuse a running service, rename `app\` to `app.old\`, copy the new `app\` in, roll back on failure, and never name `data\` (real-filesystem-tested; #87)
    ├── update-entry.ts      — `更新.bat`'s program half: print the updater's answer in Chinese, keep a success on screen, and leave a non-zero exit for the launcher's `pause`
    ├── unsafe-download.ts   — the `:Zone.Identifier` check and the Chinese unblock instruction a marked download prints (unit-tested; #85)
    ├── image-sizes.ts       — the Wallpapers' own pixel sizes, read for the masonry (unit-tested)
    └── …                    — the readers (Run log, Gallery list, Mirror, thumbnails)
tests/                       — mirrors the sources it tests
├── core/                    — the crawler's tests
│   ├── app-root.test.ts
│   ├── data-layout.test.ts
│   ├── data-cycle-survival.test.ts
│   ├── logger.test.ts
│   ├── config-read.test.ts
│   ├── version.test.ts
│   ├── wallpaper-url.test.ts
│   ├── run-log-file.test.ts
│   ├── discovery/
│   │   └── discovery.test.ts
│   ├── download/
│   │   └── download.test.ts
│   ├── gallery/
│   │   ├── gallery-source.test.ts
│   │   └── gallery-state.test.ts
│   └── report/
│       ├── report.test.ts
│       ├── list-run-report.test.ts
│       └── run-log.test.ts
├── scripts/                 — the build's and the packager's own readings
│   ├── bundle-externals.test.ts
│   ├── package-layout.test.ts
│   ├── packaging-docs.test.ts — the manual's encoding and the licence's agreement with package.json (#89)
│   ├── release-notes.test.ts  — the changelog's extraction rule (#88)
│   ├── release-tag.test.ts    — the tag/version agreement (#88)
│   └── zip.test.ts
└── web/                     — the Console's tests
    ├── server/              — the service's and the updater's tests (and their two helpers): the routes' surface, the exit's `409`/`202`s (`exit-api.test.ts`), the Run control and its lifetimes, the readers, the instance record and handshake, the updater
    └── src/                 — the page's tests
        ├── lib/
        │   ├── masonry.test.ts
        │   ├── poll.test.ts
        │   ├── console-api.test.ts
        │   ├── gallery-figures.test.ts
        │   ├── run-panel.test.ts
        │   ├── run-start.test.ts
        │   └── wall-state.test.ts
        └── i18n/
            ├── messages.test.ts
            └── vocabulary-guard.test.ts — every runtime tuple in web/api-types.ts is enumerated by the dictionary test or exempt with a reason (#112)
scripts/
├── check-branch.mjs  — pre-commit guard: refuse to commit on the default branch
├── build.ts          — the build: Vite's page + three esbuild entries (Console, Run, updater) into `build/`, one `RE1999_VERSION` define, the tree's package.json, and a refusal when a bundle left an undeclared import
├── bundle-externals.ts — the build's two pure readings of esbuild's metafile: undeclared externals (`sharp` is the only allowed one) and the packages that did bundle (unit-tested)
├── package-version.ts — the one `package.json` version reader, shared by the build and the packager
├── package-layout.ts — the archive's whitelist and the packager's pure decisions: which archived paths may exist, the root files taken generically from `packaging/`, the generated `app/.env` template, and the `node.exe` source (`RE1999_NODE_EXE` is #88's seam) (unit-tested)
├── package.ts        — `pnpm package`: collect `build/` + `packaging/` + Node + sharp's closure into `dist-package/re1999-wallpaper-crawler-v<version>.zip`, asserting the whitelist before the zip is written
├── release-notes.ts  — the Release body: exactly one `## X.Y.Z` section of `CHANGELOG.md`, failing loudly when it is missing, empty or duplicated; CLI prints it or writes `--out` (#88, unit-tested)
├── release-tag.ts    — the tag/version agreement: a `vX.Y.Z` tag must equal `package.json`'s version, checked by function rather than inline YAML; CLI prints the version, `--package` is the dry run (#88, unit-tested)
└── zip.ts            — the hand-written zip writer (node:zlib, UTF-8 names, no zip64) (unit-tested)
packaging/
├── 启动.bat          — the portable package's entry point (#85): ASCII-only, `cd /d "%~dp0app"`, the two root variables, `app\node.exe app\server.js`, then an unconditional `pause` so the window keeps its last lines after a clean exit too, and `pause` before a non-zero exit (#96). #86 copies it to the archive root byte for byte
├── 更新.bat          — the updater's entry point (#87): the same ASCII/CRLF shape, `app\node.exe app\update.js "%~dp0." %*` — the package root plus the path the user dragged, if any
├── 使用说明.txt      — the player's manual (#89): UTF-8 with a BOM and CRLF, read in Notepad. Start and stop, the first download's size/time, update, rollback, uninstall, where `data\` is, Mark-of-the-Web, and where to ask; the packager takes it from here generically
└── site.env          — the committed site constants the packager writes as `app\.env`; the repository's own `.env` is the owner's and is never read by a release build
```

`LICENSE` at the root is MIT, with a plain statement that the wallpapers belong
to the official site and that this project stores or distributes none;
`package.json`'s `license` field is the same word rather than a second truth.
`tests/scripts/packaging-docs.test.ts` pins that agreement and the manual's
reader-facing facts.

`build/` itself is generated, never source: `pnpm build` writes it and
`.gitignore` keeps it out of the tree. It is a complete application root, which
is what a package ships (#86) and what `pnpm webui` runs.

`pnpm package` adds `dist-package/` (gitignored): one zip whose root is
`启动.bat`, `更新.bat` and `使用说明.txt` beside `app\`, with **no `data\`** — the
launcher creates it (#85) and the updater only ever swaps `app\` (#87).
`app\.env` is generated from `packaging/site.env`, never copied from the working
tree; the archive root's files are every `.bat`/`.txt` in `packaging/`, so #87
and #89 add a file and no packager code. `app\node_modules` is `sharp` **and the
four packages sharp itself loads** (`@img/colour`, `@img/sharp-win32-x64`,
`detect-libc`, `semver`): shipping `sharp` alone boots but answers every
thumbnail with a 500. The whitelist predicate and a real `pnpm package` run are
what keep a release from carrying the owner's data.

A Run's data lives in the data directory, never in the program directory: `<data>/images` (the Mirror), `<data>/logs` (the Run logs) and `<data>/cache/thumbnails` (the disposable thumbnail cache, outside the Mirror by ADR 0010), with `data/user.env` from #78. `core/data-layout.ts` owns that arrangement and the `layout.json` version marker; a pre-#80 checkout is migrated by a same-volume rename on the first start, and an unrecognised or newer layout refuses to start instead of guessing. The built tree (`build/`) is what travels with the program — three bundles and the page — and no source file does; there is no other root directory — the run-code copy that used to live in `.run-cache/` went with the browser crawl (#76). Nothing under the data directory is ever deleted by the program (ADR 0019).

Tests mirror the source tree under `tests/` (`core/report/report.ts` → `tests/core/report/report.test.ts`, `web/server/server.ts` → `tests/web/server/server.test.ts`, `web/src/lib/masonry.ts` → `tests/web/src/lib/masonry.test.ts`); `vitest.config.ts` scopes collection to `tests/**/*.test.ts`, so a test file left in a source tree never runs. The service's surface is the exception in the other direction: `routes/` and `http/` have no per-file tests, because what they are is only meaningful as a whole — their tests are the socket tests at `tests/web/server/`, which drive the bound service over a real socket.

**Discovery is the Gallery list** (ADR 0018, closing the gate ADR 0006 opened):
the site's own list endpoint returns every entry and every `pictureUrl` in one
unauthenticated request, and before #76 that list was only the authority the
browser capture was checked against. Now it *is* the URL set — one Run covers the
whole gallery — which also makes `gallery.officialTotal` exact and the
new-vs-known delta id-keyed. A Run has no browser, no session and no captured
traffic to filter; the Site asset rules in `core/wallpaper-url.ts` remain the
vocabulary for "is this a Wallpaper", off the Run's path.

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
`docs/agents/branch-reference.md`. It carries the six lessons that moved out of
this file — the `createRequire` bundling banner, the launcher's ASCII rule, the
manual's encoding, the line-ending rule, the synchronous Run log, and where the
git hooks live — unchanged; `pnpm smoke:boot` is the check that now carries the
bundling one. A new lesson that only one of those branches needs goes there, not
here: this file keeps what a first command needs.

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
