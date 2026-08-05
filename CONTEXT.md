# Wallpaper Scraper — Project Context

A wallpaper scraper for Bluepoch's official wallpaper gallery (re.bluepoch.com).
It drives a real browser through the SPA, captures every image request on the
network layer, filters them down to real wallpapers, and downloads them to
disk. The repo is one project split into two sub-domains — **Discovery** and
**Download** — joined by the **Wallpaper URL set**.

## Language

### Shared

**Wallpaper**:
An image that passed discovery filtering (not an icon, SVG, data: or blob:
URI) and is queued for download to disk.
_Avoid_: picture, background, 壁纸

**Image**:
Any image URL observed by the browser — from a network response or a DOM
element — before filtering. Broader than Wallpaper.
_Avoid_: wallpaper (as a name for the raw captured artifact)

**Wallpaper URL set**:
The deduplicated, filtered collection of Wallpaper URLs produced by Discovery
and consumed by Download (bridged across processes via `window.__wpUrls`).
_Avoid_: URL list, allUrls, manifest

**Browser session**:
A named, persistent Chrome profile managed by Playwright CLI (`bluepoch`).
It carries cookies and login state across the whole run.
_Avoid_: tab, profile

### Discovery

**Discovery**:
The sub-domain that traverses the page and produces the Wallpaper URL set.
_Avoid_: scraping, crawling

**Discovery script**:
The run-code script (`scripts/run-discovery.js`) executed inside the Browser
session that performs the whole page traversal.
_Avoid_: scraper script, spider

**Network-first capture**:
Capturing image URLs from network responses via `page.on("response")` instead
of scanning the DOM. The DOM only drives scrolling and clicks.
_Avoid_: DOM scraping

**Virtual scroll list**:
A page region that renders only visible thumbnails and grows its scrollable
height as you scroll — the central mechanism that triggers lazy loading.
_Avoid_: container, scroll container

**Lazy loading**:
The site loads images on demand as thumbnails enter the viewport; scrolling is
what forces the next batch to render and fire network requests.
_Avoid_: on-demand loading

**Thumbnail**:
A clickable small tile in a Virtual scroll list. Clicking opens a High-res
preview.
_Avoid_: tile, mini image

**High-res preview**:
The popup dialog opened by clicking a Thumbnail, showing the full-resolution
image. Opening it is what triggers the high-res network request.
_Avoid_: zoom, detail popup

**Stability loop**:
The settling loop at the end of Discovery that keeps scrolling and waits until
no new image requests arrive and the page height is stable — proof that
discovery is complete.
_Avoid_: convergence, idle detection

### Download

**Download**:
The sub-domain that consumes the Wallpaper URL set, fetches each URL, and
writes files to disk.
_Avoid_: fetching, saving

**Download outcome**:
The classification of one attempted download — `ok`, `skipped`, or `failed`.
_Avoid_: result, status

**Content-hash skip**:
Skipping a download because a file with the same name already exists on disk.
CDN filenames embed a content hash, so same name means same content.
_Avoid_: dedup, existing-file check

**403 retry**:
The second download attempt after a 403, sent with full browser headers
(Accept, Sec-Fetch-*) because the CDN rejects minimal requests.
_Avoid_: header escalation

**Session cookies**:
The cookie header extracted from the Browser session and attached to downloads
so gated images succeed.
_Avoid_: auth, login

## Architecture

### Network-first capture (the core principle)

Discovery is network-first: a Node.js listener records every response whose
`content-type` is `image/*`. The DOM is never the source of truth — it only
drives scroll, clicks, and hash injection. This survives SPA virtual scroll,
which unmounts off-screen images and makes DOM counting unreliable.

### Discovery pipeline

1. Open a persistent headed Chrome session (`viewport: null` + 1920×1080
   window) and navigate to the wallpaper page.
2. Inject the `#wallpaper` page hash, reload, and re-inject.
3. Scroll the Virtual scroll lists repeatedly (dynamic `scrollHeight`), then
   click every Thumbnail to trigger High-res preview requests.
4. Run the Stability loop until 45s pass with no new image AND the total
   scroll height is unchanged, for 6 consecutive rounds.
5. Merge network captures with DOM `img[src]` URLs, filter through
   `shouldKeep` (drops icons, SVGs, data:/blob:), and publish the result as
   the Wallpaper URL set.

### Download pipeline

1. Extract Session cookies from the browser.
2. Download in parallel batches of `BATCH_SIZE`; skip files that already exist
   (Content-hash skip).
3. On 403, retry once with full browser headers (403 retry).
4. Summarize ok / skipped / failed + total size on disk.

## Gotchas

- **Windows / cmd.exe**: the Discovery script must be passed via `--filename`
  (temp file), never inline — cmd.exe mangles multi-line strings and `#`.
- **`.env` `#` is a comment char**: `PAGE_HASH=#wallpaper` is hardcoded in
  `src/config.ts`, not read from `.env`.
- **Viewport matters**: the site renders a mobile layout for small viewports;
  `viewport: null` + window size forces the desktop version.
- **run-code runs in Node.js, not the browser**: `window`/`document` only
  exist inside `page.evaluate()`; the cross-process bridge is
  `window.__wpUrls` / `window.__wpLog`.
- **undici is required**: Node's `fetch` forbids setting the `Cookie` header;
  undici's `fetch` allows it.
- **Fixed `scrollHeight` caps break virtual scroll**: the loop must re-read
  `scrollHeight` each iteration, or lazy-loaded content is never reached.
- **Network-layer decoupling**: don't gate waits on `networkidle` — the SPA
  reports idle while lazy loads are still pending. Use the Stability loop
  (time + height) instead.
