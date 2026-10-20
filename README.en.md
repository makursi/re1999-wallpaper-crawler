# Reverse: 1999 Wallpaper Downloader

[中文](README.md) | **English**

The tool downloads every wallpaper from the [official gallery](https://re.bluepoch.com/home/detail.html#wallpaper) to your computer and shows them on one page. The service runs on your machine only; other devices cannot reach it.

![The wallpaper wall](docs/screenshots/console-en.webp)

## Before you start

Install Node 22, pnpm and Chrome. Then open a terminal in this folder (on Windows, PowerShell) and run these lines one at a time:

```bash
npm install -g @playwright/cli
npx playwright-cli install
pnpm install
```

## Start it

```bash
pnpm webui
```

The terminal prints one address, and the browser opens it:

```
WebUI: http://127.0.0.1:8791/?token=…
```

The first start builds the page; later starts reuse that build and open faster. If no browser opens, paste the whole address into the address bar. The token is the access credential — without it the page does not load.

## The page

The wall lays wallpapers out in five columns, each at its own proportions, uncropped. An outlined tile means the gallery has it and your computer does not.

Click a tile to open the original, zoom in and out, and press Esc to close.

“Run” in the top-right corner starts a download. A Chrome window opens, pages through the gallery by itself, and saves the new wallpapers.

“Mirror 1013” is how many you already have; “Gallery list 1010” is how many the site holds. The next line gives two counts: wallpapers the gallery lists but you do not have, and local files the gallery no longer lists.

Switch between 中文 and English at any time; the page remembers your choice.

## While a Run is going

The Chrome window pages through the gallery by itself. Do not click in it, and do not close it.

Closing the page does not stop the download. Press Ctrl+C to end the service, and unfinished downloads stop with it.

Files already on disk are skipped, so a Run only fetches new wallpapers, and re-running is safe.

## Reading the result

When a Run ends, the Run panel gives one of three verdicts:

- clean: nothing was flagged.
- explained: a routine case, such as the site’s own background art being filtered out correctly, or a few local files the gallery has since removed. These are recorded without affecting your copy.
- defect: this Run did not see everything, or some files failed. Running it once more usually settles it.

## Common problems

- “Set up the site first”: the `.env` file is missing. Create a plain text file named `.env` in this folder, write these two lines, save, and refresh the page.

  ```
  BASE_ORIGIN=https://re.bluepoch.com
  PAGE_PATH=/home/detail.html
  ```

  Windows Explorer refuses a file name that starts with a dot. Add one more dot at the end (`.env.`) and Windows drops it for you.

- “Orphaned Run”: the previous Run was interrupted, so its log stops before the report. Click “Clean up” to close the leftover browser session, then start a new Run. The log itself is never edited or deleted.

- A tile marked “not on disk”: the gallery has it, but it is not downloaded yet; the next Run fetches it.

- Something else: keep the newest file in the `logs` folder. It records the whole Run.

## Where files go

- `images`: the wallpaper files.
- `logs`: one JSONL log per Run.

## For developers

See [AGENTS.md](AGENTS.md) for the architecture, commands and conventions, [CONTEXT.md](CONTEXT.md) for the vocabulary, and `docs/adr/` for the design decisions.
