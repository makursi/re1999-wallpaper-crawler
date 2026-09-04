# Wallpaper Scraper

Download official [Bluepoch](https://re.bluepoch.com/home/detail.html#wallpaper)
wallpapers (`重返未来：1999`) to your disk. It drives a real Chrome browser
through the SPA, captures every image request on the **network layer**, filters
out UI icons, and downloads the remaining wallpapers in parallel batches.

> **Status (2026-09-04)**: the official gallery has been fully crawled — 971
> files already sit in `images/`. Re-running is idempotent: anything new that
> Bluepoch uploads gets downloaded, everything already on disk is skipped.

---

## Quick start

```bash
# 1. Prerequisites (once)
npm install -g @playwright/cli
npx playwright-cli install

# 2. Project dependencies
npm install

# 3. Run — opens a real Chrome window, takes a few minutes
npm run save-wallpapers
```

Downloaded wallpapers land in `./images/`. Done — **do not touch the browser
window** while it runs; a stray click disturbs discovery. A run log is written
to `logs/save-wallpapers-<timestamp>.jsonl` each time.

<details>
<summary>Run output — what you should see</summary>

```
Total images found : 21
Successfully saved : 0
Skipped (existing) : 21
Failed             : 0
```

`Skipped` = already on disk (Content-hash skip). A re-scrape that downloads
nothing is the normal, clean state — not a failure.
</details>

---

## Configuration (optional)

The scraper works out of the box with the defaults below. Only
`BASE_ORIGIN` / `PAGE_PATH` are required — copy `.env` from the table or edit
the existing one:

| Variable | Default | Meaning |
|----------|---------|---------|
| `BASE_ORIGIN` | **required** | Site origin, e.g. `https://re.bluepoch.com` |
| `PAGE_PATH` | **required** | Gallery page path, e.g. `/home/detail.html` |
| `SESSION_NAME` | `bluepoch` | Persistent browser session (keeps login state) |
| `IMAGES_DIR` | `images` | Where wallpapers are saved |
| `BATCH_SIZE` | `4` | Parallel downloads per batch (1–20) |
| `PLAYWRIGHT_CONFIG` | `.playwright/config.json` | Chrome launch settings |
| `LOG_DIR` | `logs` | Where JSONL run logs are written |

`.env` is validated at startup by `zod` — a bad value fails fast with a clear
error instead of silently misbehaving.

---

## Verifying a run

Each run produces one structured report. To check a run was clean:

```bash
grep '"type":"run_report"' logs/save-wallpapers-*.jsonl | tail -1
```

Look at the `defects` object — it should be empty or explainable. Three things
read like problems but are **by design**:

- **`download.successRate: 0` with all `skipped`** — everything was already on
  disk. Clean re-scrape, not a failure.
- **`discoveryLeak` listing only `re.bluepoch.com/home/detail.html`** — the page's
  own HTML response, captured by the network listener, never downloaded.
  Benign — don't re-run for it.
- **`combinedCount` below baseline** — if `images/` already holds everything the
  site exposes (all downloads Content-hash skipped) and the page shows only a
  handful of thumbnails, the gallery is simply exhausted. Not a regression.

---

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| 403 errors on download | CDN rejected minimal headers — the scraper auto-retries with full browser headers once. If everything 403s, the browser session may be logged out: log in once in the persistent profile, then re-run. |
| Run takes >10 min | Normal on slow networks — discovery keeps probing until the list stops growing (90s cap per probe round, 900s overall timeout). |
| `No images found` in summary | `emptyResult` defect: session logged out or the site changed. Grep `"phase":"run-code"` in the log for `[final]` / `[thumbnails]` diagnostics. |
| Scraper says `Browser 'bluepoch' is not open` if probed manually | Expected pre-run state — the run owns the session (clears and reopens it). Just run. |

---

## Project structure

```
src/
├── main.ts                       — orchestration: clear session → open browser → discover → download → report
├── config.ts                     — zod-validated .env config, shared constants
├── logger.ts                     — pino: pretty console + JSONL file
├── discovery/discovery-loader.ts — reads scripts/run-discovery.js, injects PAGE_HASH
├── download/download.ts          — parallel batch downloads (undici), cookie auth, 403 retry
└── report/report.ts (+ .test.ts) — pure analysis: detectLeaks, classifyOutcomes, buildRunReport
scripts/run-discovery.js          — Playwright CLI run-code script: scroll + thumbnail clicks + stability loop
images/                           — downloaded wallpapers
logs/                             — one JSONL run log per run
```

## How it works

1. **Network-first capture** — a `page.on("response")` listener records every
   image request. The DOM is never the source of truth; it only drives
   scrolling and thumbnail clicks to trigger lazy loads.
2. **Discovery** — inject the `#wallpaper` hash, reload, scroll the virtual
   list (dynamic `scrollHeight`), click every thumbnail for the high-res
   request, then a **stability loop** settles: no new image for 45s **and**
   unchanged scroll height, 6 rounds.
3. **Filter** — drop icons, SVGs, `data:`/`blob:` URIs.
4. **Download** — parallel batches of `BATCH_SIZE`, reusing the browser's
   cookies; skip files already on disk; on 403 retry once with full browser
   headers.

## Commands

| Task | Command |
|------|---------|
| Scrape | `npm run save-wallpapers` |
| Tests | `npm test` |
| Typecheck | `npx tsc --noEmit` |
| Lint | `npx eslint .` |