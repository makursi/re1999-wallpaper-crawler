# Filter Site assets out of the Wallpaper URL set

Discovery captures every image request the page makes, and the capture also
picks up resources that are not Wallpapers: the page's own HTML document, the
Baidu Analytics 1x1 pixel, the page background, music-player covers, and the
site icon. They were queued for download like any Wallpaper, so `images/`
accumulated six non-Wallpaper files (`hm.gif`, `detail.html`, `BG2.png`,
`1.png`, `Vinyl record.png`, `icon-192_….png`) and every Run re-attempted them.

We mark those resources as **Site assets** and drop them between the raw
capture and Download: the analytics host, the `/home/img/` path prefix, the
`icon-` filename prefix, and anything that is not an image URL at all.

The rules are structural rather than an exact-filename list, because the
analytics pixel arrives with a different query string on every request (22
distinct URLs across `logs/`) and the icon filename embeds a build hash.

## Considered options

- **Allowlist the wallpaper CDN path (`/PICTURE/`) instead**: looks more
  robust, but it fails silently — if the site moves the gallery, every Wallpaper
  is dropped and the Run looks like a clean empty result. A denylist can only
  over-download, which is visible and recoverable. Rejected.
- **List the exact junk filenames**: breaks on the next icon rebuild and on
  pixel query strings. Rejected after inspecting the captured URLs.
- **Filter inside the Discovery script** (`shouldKeep`): keeps the cross-process
  bridge clean, but the rules would live in untyped, untested JavaScript.
  Rejected; the filter is TypeScript in `src/wallpaper-url.ts`. **2026-09-15:**
  the script's own filter was then removed entirely — it kept dropping SVG art
  and 23 UI icon filenames before the capture was published, so `combinedCount`
  was never quite the raw capture and those drops never reached the report. Its
  icon list is now a `filenameIn` rule beside the others, and only `data:` /
  `blob:` payloads are dropped before capture, because they are not URLs the
  crawler can fetch. See ADR 0006.
- **Only drop non-image URLs** (i.e. reuse the existing leak check): leaves
  every site image asset in the download queue. Rejected.

## Consequences

- `discovery.combinedCount` describes the raw capture (everything but `data:` /
  `blob:` payloads), so its meaning is unchanged and Runs stay comparable; the
  gap down to `download.total` is explained by `siteAssets` in the Run report.
  Before 2026-09-15 the script's own filter sat in between and made this
  sentence untrue; it is true now that that filter is gone (ADR 0006).
- `defects.discoveryLeak` keeps its meaning — a non-image URL in the *raw*
  capture — so the long-documented benign `detail.html` leak still shows up
  there. It is now also reported as a Site asset, and never downloaded. Since
  non-image URLs are always Site assets, the leak list is a subset view of
  `siteAssets.urls`: a leak that appears there is explained.
- **A rule that drops a real Wallpaper is detected, not inferred**: every Run
  diffs the drops against the site's own gallery list, and a dropped URL the
  list contains is reported as `siteAssetFalsePositive` (ADR 0006). Junk that
  does reach the disk shows up in the same check as `extraOnDisk`.
- `images/` holds Wallpapers only, which is what makes the mirror check
  (ADR 0006) a clean number.
- There is one filter pass, in TypeScript, with unit tests. The two-pass split
  described in the first version of this ADR is history.
