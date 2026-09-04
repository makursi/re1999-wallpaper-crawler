# Wallpaper Scraper

Download official [Bluepoch](https://re.bluepoch.com/home/detail.html#wallpaper)
wallpapers (`重返未来：1999`) to your disk. It drives a real Chrome browser
through the SPA, captures every image request on the **network layer**, filters
out UI icons, and downloads the remaining wallpapers in parallel batches.

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

Downloaded wallpapers land in `./images/`. Don't touch the browser window
while it runs — a stray click disturbs discovery. Each run writes a log to
`logs/save-wallpapers-<timestamp>.jsonl`. Re-runs are idempotent: files already
on disk are skipped.

## Configuration (optional)

The scraper works out of the box. Only `BASE_ORIGIN` / `PAGE_PATH` are
required — edit `.env` (validated at startup by zod):

| Variable | Default | Meaning |
|----------|---------|---------|
| `BASE_ORIGIN` | **required** | Site origin, e.g. `https://re.bluepoch.com` |
| `PAGE_PATH` | **required** | Gallery page path, e.g. `/home/detail.html` |
| `SESSION_NAME` | `bluepoch` | Persistent browser session (keeps login state) |
| `IMAGES_DIR` | `images` | Where wallpapers are saved |
| `BATCH_SIZE` | `4` | Parallel downloads per batch (1–20) |
| `LOG_DIR` | `logs` | Where JSONL run logs are written |

## How it works

1. **Network-first capture** — a `page.on("response")` listener records every
   image request; the DOM only drives scrolling and thumbnail clicks.
2. **Discovery** — inject the `#wallpaper` hash, reload, scroll the virtual
   list, click every thumbnail for the high-res request, then wait until no
   new image arrives for 45s with an unchanged scroll height (6 rounds).
3. **Filter** — drop icons, SVGs, `data:`/`blob:` URIs.
4. **Download** — parallel batches of `BATCH_SIZE`, reusing the browser's
   cookies; skip files already on disk; on 403 retry once with full headers.

## Commands

| Task | Command |
|------|---------|
| Scrape | `npm run save-wallpapers` |
| Tests | `npm test` |
| Typecheck | `npx tsc --noEmit` |
| Lint | `npx eslint .` |