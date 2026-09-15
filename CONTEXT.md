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
The raw capture may still carry Site assets; the Site asset filter drops them
before Download sees the set.
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

**Site asset**:
A resource the page or the CDN serves alongside the gallery that is not a
Wallpaper: the page's own HTML document, analytics pixels, and the site's UI
art (page background, music-player covers, icons). Marked by the rules in
`src/wallpaper-url.ts` and never downloaded.
_Avoid_: junk, noise, non-image (a Site asset can be an image)

**Site asset filter**:
The stage that partitions the raw capture into Wallpapers and Site assets
before Download, so the Wallpaper URL set Download consumes contains neither
Site assets nor non-image URLs. It is the only filter: the Discovery script
drops nothing but `data:`/`blob:` payloads, which are not URLs the crawler can
fetch. Every drop is reported, and every Run checks the drops against the
Gallery list, so a rule that swallows a Wallpaper is caught rather than
inferred. See docs/adr/0004.
_Avoid_: cleanup, sanitizer

### Gallery tracking

**Gallery list**:
The site's own inventory of the gallery, from its list endpoint: every entry
with the id the gallery numbers it by, plus the total. One request, no session.
It is the authoritative Wallpaper URL set.
_Avoid_: API, endpoint, manifest

**Gallery total**:
What the Gallery list says the gallery holds. Not a count of local files, and
it can fall when the site retires an entry. `null` when the list could not be
read.
_Avoid_: image count, total images, 图片总数

**Gallery state**:
The persisted record of the entry ids previous Runs have seen
(`images/.gallery-state.json`), which is what lets a Run report
`newSinceLastRun`. Ids are never forgotten: the site can retire an entry and
put it back, and forgetting it would report the re-appearance as new twice.
It lives beside the Mirror it describes and is deleted with it.
_Avoid_: cache, checkpoint

**New since the last Run**:
The entries whose id the previous Run's Gallery list did not carry — the answer
to "did the site publish anything?". `null`, not `0`, on a first Run: there is
nothing to compare against.
_Avoid_: delta, growth, 新增

**Mirror**:
The local copy of the gallery — the Wallpaper files in `images/`.
_Avoid_: library, collection, dataset

**Mirror gap**:
A difference between the Gallery list and the Mirror: `missingFromDisk`
(official entries with no local file) or `extraOnDisk` (local files the list
does not contain — retired art, or junk the filter let through).
_Avoid_: diff, drift

**Discovery coverage**:
The share of the Gallery list that one Run's capture contained. A Run sees a
small slice by design; the number says how small.
_Avoid_: hit rate, recall

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

### Diagnostics

**Run**:
One invocation of the whole scraper, from session clear through download
summary, producing one JSONL log and one Run report.
_Avoid_: execution, session run

**Run 稳定性 (Run stability)**:
The degree to which a single Run completes both pipelines and produces a
trustworthy outcome, measured by: discovery convergence, download success
rate, 403 retry rescue rate, and absence of leak/anomaly signals. Cross-run
consistency is only tracked for the Gallery total; other aggregation-phase
signals are future work.
_Avoid_: reliability, health

**Run parity (运行等价)**:
The standard for accepting a pipeline change: a post-change Run's `run_report`
structure must be byte-identical in shape to a pre-change baseline (same
fields, same contract), and its observable metrics — `combinedCount`, success
rate, convergence — must not materially regress. Used to prove an
implementation swap (e.g. module system, runtime) kept behavior equivalent.
_Avoid_: run quality, 运行质量, no regression

**运行缺陷 (Run defect)**:
An anomaly detectable from the log that shows the crawl deviated from
expectations. Classes: discovery leak, convergence failure, empty result,
persistent failure, empty file, Site asset false positive, gallery source
unavailable, mirror gap. Cross-run drift beyond the Gallery list is a future,
aggregation-phase class.
_Avoid_: bug, error, failure (as a blanket term)

**Run report**:
The single structured log record (`type: run_report`) that aggregates one
Run's stability signals, its Gallery numbers and Mirror gap, the Site assets it
filtered, the capture's Discovery coverage, and detected defects, so an Agent
can assess the run without re-parsing the whole log.
_Avoid_: summary, dashboard, report file

**run_meta**:
The first log record of a Run carrying runId, timestamps, and a config
snapshot, so cross-run analysis is not confounded by config drift.
_Avoid_: header, preamble

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
5. Merge network captures with DOM `img[src]` URLs — dropping only
   `data:`/`blob:` payloads, which are not URLs — and publish the result as the
   raw capture.
6. Partition that capture with the Site asset filter (`src/wallpaper-url.ts`)
   — analytics pixels, site UI art, the page's own HTML — hand only Wallpapers
   to Download, and check the drops against the Gallery list. That list is
   fetched once, here, and reused for the Gallery state at the end of the Run.

### Download pipeline

1. Extract Session cookies from the browser.
2. Download in parallel batches of `BATCH_SIZE`; skip files that already exist
   (Content-hash skip).
3. On 403, retry once with full browser headers (403 retry).
4. Summarize ok / skipped / failed + total size on disk, then refresh the
   Gallery state from that same list: compare it with the Mirror and record the
   ids for the next Run.

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
