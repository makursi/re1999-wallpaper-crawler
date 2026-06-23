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
| Scrape wallpapers | `npm run save-wallpapers` (`ts-node src/main.ts`) |
| Lint | `npx eslint .` |

There are no tests (the `test` script is a stub).

## Architecture

```
src/
├── config.ts    — zod-validated .env config, re-exports resolved constants
├── main.ts      — orchestration: clear session → open browser → run discovery → extract URLs → download → summary
├── scraper.ts   — reads scripts/run-discovery.js and injects PAGE_HASH
├── download.ts  — parallel batch downloads via undici, cookie auth, 403 retry
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
- TypeScript strict mode, CommonJS module system, compiled via `ts-node` at runtime
- Formatting: semicolons are off (`semi: false`), use single quotes
