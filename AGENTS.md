# AGENTS.md

## Project identity

Wallpaper scraper for [Bluepoch](https://re.bluepoch.com) using **Playwright CLI** (`@playwright/cli`), _not_ Playwright Test or the Playwright library. It launches a real Chrome browser, clicks through a SPA page, captures image URLs from network traffic, and downloads them in parallel.

## Prerequisites

`@playwright/cli` must be installed globally:

```bash
npm install -g @playwright/cli
npx playwright-cli install
```

Then `npm install` for project dependencies.

## Commands

| Task | Command |
|------|---------|
| Scrape wallpapers | `npm run save-wallpapers` (`tsx src/main.ts`) |
| Tests | `npm test` (`vitest run`) |
| Typecheck | `npx tsc --noEmit` |
| Lint | `npx eslint .` |

## Git Conventions (every iteration)

All work lands on `main` only through a merged PR. **Never commit on `main`
(or `master`), and never touch a file before the branch exists** — the first
action of every iteration is step 1, not an edit.

This is enforced, not just asked: `.githooks/pre-commit` refuses a commit when
HEAD is on `main`/`master` or detached. Activate it in a fresh clone with:

```sh
git config core.hooksPath .githooks
```

`git commit --no-verify` bypasses it — if you ever use it, say why in the PR.

Every iteration ships via this exact flow, in order:

1. `git checkout -b <type>/<short-slug>` — type: `feat` / `fix` / `refactor` / `docs` / `chore`
   — **before** editing anything
2. Commit in English, conventional style (never Chinese in commit messages)
3. `git push -u origin <branch>`
4. `gh pr create --base main` (title = commit subject), then after review:
   `gh pr merge --squash --delete-branch`
5. `git checkout main && git pull`

## Project history (read before changing pipeline internals)

`HISTORY.md` records **why the code is shaped the way it is** — each iteration's
trigger, decision (including rejected approaches), verification numbers, and
lessons. Scan it before modifying discovery/download internals or re-proposing
any approach listed there as rejected; it keeps prior dead ends from being
re-walked. It does not repeat current facts — those live above, in `src/`, in
CONTEXT.md, and in `docs/adr/`.

## Analyzing a run's logs

Each run writes one JSONL file in `logs/`: `save-wallpapers-<runId>.jsonl`. To
assess run stability, find defects, and propose optimizations:

1. Pick the newest file in `logs/`.
2. Grep `"type":"run_report"` — one structured record with all metrics and
   detected defects.
3. Grep `"type":"run_meta"` — runId, start time, and the config snapshot
   (to rule out config drift).
4. Grep `"phase":"run-code"` — the discovery diagnostics (`[stability]`,
   `[final]`, `[thumbnails]`).

How to judge a run:

- **Discovery**: `discovery.converged` (false ⇒ not converged), `stableRounds`,
  `totalIdleSec`, `combinedCount` (URLs captured, Site assets included).
- **Download**: `download.successRate` = ok / (ok+failed),
  `download.rescueRate` = 403s rescued by retry, `download.failed`,
  `download.statusHistogram`, `download.failureGroups`.
- **Gallery**: `gallery.officialTotal` = Wallpapers known in total,
  `gallery.newSinceLastRun` = added since the previous Run, `gallery.firstRun`
  = there was no earlier record to compare against. `previousOfficialTotal`
  should equal the previous Run's `officialTotal`.
- **Site assets**: `siteAssets.count` / `siteAssets.urls` = resources the Site
  asset filter dropped before Download — this is why `download.total` sits
  below `discovery.combinedCount`.
- **Defects** (auto-detected in `defects`): `discoveryLeak`, `nonConverged`,
  `emptyResult`, `persistentFailures`, `emptyFiles`.

Reading traps:
- An all-skipped run reads `download.successRate: 0` **by design** — the
  rate is ok / (ok+failed), and every file already on disk is Content-hash
  skipped, so 0 ok / 0 failed is a clean re-scrape, not a failure.
- A `combinedCount` below the Gallery total is expected and **not a defect**:
  the page renders only the thumbnails in view, so a Run sees a subset. Read
  `gallery.newSinceLastRun` to tell "nothing new on the site" (0) from "the
  crawl regressed" — the latter surfaces as `nonConverged` or an empty
  capture, not as a small `combinedCount`.
- A `discoveryLeak` whose only URL is the page's own HTML URL (e.g.
  `re.bluepoch.com/home/detail.html`) is benign: it is also reported as a
  Site asset, is never downloaded, and never counts toward the Gallery total.
  Accept it, don't re-run for it. A leak naming anything else means the Site
  asset rules need looking at.
- **Cross-run trends**: compare `gallery.officialTotal` /
  `gallery.newSinceLastRun` / `download.successRate` / `defects` across files.
  The Gallery total is the cross-run signal (ADR 0005) — a drop in
  `combinedCount` alone says nothing. Aggregation beyond that is not yet
  automated.

Optimization leads to look for: low `rescueRate` ⇒ retry/header policy;
`failureGroups` dominated by one status ⇒ that status's handling;
high `avgDownloadMs` ⇒ batch-size/parallelism tuning; `nonConverged` ⇒
stability-loop parameters or missing thumbnails.

## Architecture

```
src/
├── config.ts                — zod-validated .env config, shared constants
├── logger.ts                — pino with pretty console + JSONL file output
├── main.ts                  — orchestration: clear session → open browser → run discovery → extract URLs → filter Site assets → download → report
├── wallpaper-url.ts         — the Wallpaper URL set's vocabulary: isImageUrl, Site asset rules, splitWallpaperUrls (unit-tested)
├── discovery/
│   └── discovery-loader.ts  — reads scripts/run-discovery.js and injects PAGE_HASH
├── download/
│   └── download.ts          — parallel batch downloads via undici, cookie auth, 403 retry
└── report/
    ├── report.ts            — pure analysis: detectLeaks, classifyOutcomes, buildRunReport (unit-tested)
    └── gallery.ts           — cross-run Gallery total: count, merge, read/write gallery-state.json (unit-tested)
tests/
├── wallpaper-url.test.ts
└── report/
    ├── report.test.ts
    └── gallery.test.ts
scripts/
└── run-discovery.js  — Playwright CLI run-code script (async (page) => { ... })
```

Tests mirror `src/` under `tests/` (`src/report/report.ts` → `tests/report/report.test.ts`); `vitest.config.ts` scopes collection to `tests/**/*.test.ts`, so a test file left in `src/` never runs.

**Network-first design**: image URLs are captured via `page.on("response")` listening for `content-type: image/*`, _not_ from DOM scanning. DOM is only used to drive scrolling/clicking to trigger lazy loads.

## Gotchas

### Playwright CLI, not Playwright

Commands use `npx playwright-cli -s=<session>` (CLI tool), not `npx playwright test` or `import { chromium } from 'playwright'`. The CLI manages a persistent browser session by name (default: `bluepoch`).

### Windows: run-code uses --filename, never inline

cmd.exe mangles multi-line strings with `#` and quotes. The run-code script is written to a temp file (`__run_script.js`) and loaded via `--filename`. Never pass inline code via CLI arguments.

### run-code context is Node.js, not browser

The function passed to `playwright-cli run-code` runs in Node.js and receives a Playwright `page` object. Browser APIs (`window`, `document`) only work inside `page.evaluate()`.

### .env hash trap

`#` is a comment character in `.env` (dotenv). The page hash `#wallpaper` is hardcoded in `src/config.ts`, not read from `.env`.

### Viewport matters

The target site renders different layouts based on viewport. The Playwright config uses `viewport: null` + `--window-size=1920,1080` so the real window size determines the viewport, ensuring the desktop version loads.

### 403 CDN retry

Download first attempt uses cookies + UA + Referer. If 403, retries with full browser headers (`Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Sec-Fetch-Site`, `Accept`).

## Code style

- ESLint: `@antfu/eslint-config` (single quotes, no semicolons, 2-space indent)
- TypeScript strict mode, ESM module system, run via `tsx` (ADR 0003)
- Formatting: semicolons are off (`semi: false`), use single quotes
