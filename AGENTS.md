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
  `totalIdleSec`, `combinedCount` (total wallpapers found).
- **Download**: `download.successRate` = ok / (ok+failed),
  `download.rescueRate` = 403s rescued by retry, `download.failed`,
  `download.statusHistogram`, `download.failureGroups`.
- **Defects** (auto-detected in `defects`): `discoveryLeak`, `nonConverged`,
  `emptyResult`, `persistentFailures`, `emptyFiles`.
- **Cross-run trends**: compare `combinedCount` / `successRate` /
  `defects` across files. A sharp drop in `combinedCount` suggests selector
  drift. Aggregation across runs is not yet automated.

Optimization leads to look for: low `rescueRate` ⇒ retry/header policy;
`failureGroups` dominated by one status ⇒ that status's handling;
high `avgDownloadMs` ⇒ batch-size/parallelism tuning; `nonConverged` ⇒
stability-loop parameters or missing thumbnails.

## Architecture

```
src/
├── config.ts    — zod-validated .env config, re-exports resolved constants
├── main.ts      — orchestration: clear session → open browser → run discovery → extract URLs → download → report
├── scraper.ts   — reads scripts/run-discovery.js and injects PAGE_HASH
├── download.ts  — parallel batch downloads via undici, cookie auth, 403 retry
├── report.ts    — pure analysis: detectLeaks, classifyOutcomes, buildRunReport (unit-tested)
└── logger.ts    — pino with pretty console + JSONL file output
scripts/
└── run-discovery.js  — Playwright CLI run-code script (async (page) => { ... })
```

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
