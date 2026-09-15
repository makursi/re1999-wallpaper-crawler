# Wallpaper Scraper

Download every official `重返未来：1999` wallpaper from
[Bluepoch](https://re.bluepoch.com/home/detail.html#wallpaper) to your disk.

It opens a real Chrome window, walks the gallery page, captures the images on
the network layer, drops the site's own UI art, and saves the rest to `images/`
in parallel. The gallery's own list endpoint supplies the authoritative total,
so every run can say what the site holds and whether your copy still matches it.

## Quick start

Needs Node 22.22+ and [pnpm](https://pnpm.io).

```bash
# 1. Install the Playwright CLI (once, globally)
npm install -g @playwright/cli
npx playwright-cli install

# 2. Install project dependencies
pnpm install
```

**3. Create the `.env` file** in the project root — these two lines are all it
needs:

```ini
BASE_ORIGIN=https://re.bluepoch.com
PAGE_PATH=/home/detail.html
```

```bash
# 4. Run it
pnpm save-wallpapers
```

Chrome opens, and a few minutes later the wallpapers are in `images/`. Each run
also writes one log to `logs/`.

> **Two things worth knowing.** Don't click around in the browser window while
> it runs — a stray click disturbs discovery. And re-running is safe: files
> already on disk are skipped, only new wallpapers are downloaded.

## Checking a run

Every run writes one JSONL log, `logs/save-wallpapers-<runId>.jsonl`. Its last
record is a `run_report` — the whole run in a single object:

```json
{
  "discovery": { "converged": true, "combinedCount": 484, "coverage": 0.4496 },
  "download": { "total": 450, "ok": 0, "skipped": 450, "failed": 0, "successRate": 0 },
  "gallery": {
    "officialTotal": 1001,
    "newSinceLastRun": null,
    "firstRun": true,
    "mirror": { "missingFromDisk": { "count": 0 }, "extraOnDisk": { "count": 0 } }
  }
}
```

The numbers to look at:

- `gallery.officialTotal` — what the site's own list says the gallery holds
  (1001 today). It is the site's number, not a count of your files, and it can
  go down if the site retires a wallpaper.
- `gallery.newSinceLastRun` — wallpapers the site added since the previous run.
  `0` means there is nothing new; it does not mean the crawl failed. `null`
  means there was no earlier run to compare against (`firstRun: true`).
- `gallery.mirror` — your `images/` against that list: `missingFromDisk` are
  wallpapers you do not have yet, `extraOnDisk` are files the gallery no longer
  lists. Both `0` means your copy matches.
- `download.successRate` — `0` is normal when everything was already on disk:
  a skipped file is not a failure, and `ok` counts new downloads only.
- `discovery.converged` — `true` means the page walk finished, `false` means it
  gave up early. `discovery.coverage` says how much of the gallery list that
  walk actually reached; the list endpoint always reaches all of it.

`AGENTS.md → Analyzing a run's logs` lists every field and the defect checks.

## Configuration

Only `BASE_ORIGIN` and `PAGE_PATH` are required. Everything else has a default,
so you can ignore this table:

| Variable | Default | Meaning |
|----------|---------|---------|
| `BASE_ORIGIN` | **required** | Site origin, e.g. `https://re.bluepoch.com` |
| `PAGE_PATH` | **required** | Gallery page path, e.g. `/home/detail.html` |
| `SESSION_NAME` | `bluepoch` | Browser session name; keeps cookies and login state between runs |
| `IMAGES_DIR` | `images` | Where wallpapers are saved |
| `BATCH_SIZE` | `4` | Parallel downloads per batch (1–20) |
| `LOG_DIR` | `logs` | Where the JSONL run logs are written |

## How it works

A `page.on("response")` listener records every image the page requests; the DOM
is only used to scroll and click, because the gallery's virtual list unmounts
whatever scrolls out of view. Once no new image has arrived for a while and the
page has stopped growing, the capture is filtered — icons, SVGs and the site's
own UI art go away — and the remaining wallpapers are downloaded in parallel
batches of `BATCH_SIZE`, reusing the browser's cookies and retrying once with
full browser headers if the CDN answers 403.

Alongside that, each run asks the site's own gallery list (one POST, no login)
for every entry it holds. That list is the authority behind `officialTotal`, the
id-keyed `newSinceLastRun`, and the mirror check — and it is what proves the
filter kept the right things: a dropped URL the list calls a wallpaper is
reported, not silently lost.

Vocabulary, the run checklists and the decisions behind all of this live in
`CONTEXT.md` and `docs/adr/`.

## Development

| Task | Command |
|------|---------|
| Tests | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Format | `pnpm fmt` (check only: `pnpm fmt:check`) |
