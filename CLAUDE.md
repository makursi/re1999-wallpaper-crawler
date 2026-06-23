# CLAUDE.md

Wallpaper scraper for [Bluepoch](https://re.bluepoch.com) using Playwright CLI (`@playwright/cli`), not Playwright Test.

## Prerequisites

```bash
npm install -g @playwright/cli
npx playwright-cli install
npm install
```

## Commands

- Scrape: `npm run save-wallpapers`
- Lint: `npx eslint .`

No tests exist (script is a stub).

## Key facts

- **Playwright CLI**, not Playwright Test or the `playwright` library. Uses `npx playwright-cli -s=<session>`.
- **Windows only**: run-code scripts are passed via `--filename` (temp file), never inline — cmd.exe mangles multi-line strings.
- `run-code` callback runs in Node.js, receives `page`. Browser APIs only work inside `page.evaluate()`.
- `.env` `#` is a comment char; `PAGE_HASH=#wallpaper` is hardcoded in `src/config.ts`.
- Viewport: `viewport: null` + `--window-size=1920,1080` for correct desktop rendering.
- Image capture is network-first (`page.on("response")`), not DOM-based.
- Download 403 → retry with full browser headers.
- ESLint: `@antfu/eslint-config` (single quotes, no semis, 2-space indent).
