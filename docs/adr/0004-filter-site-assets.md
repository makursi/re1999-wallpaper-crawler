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
  Rejected; the filter is TypeScript in `src/wallpaper-url.ts`.
- **Only drop non-image URLs** (i.e. reuse the existing leak check): leaves
  every site image asset in the download queue. Rejected.

## Consequences

- `discovery.combinedCount` still describes the raw capture, so its meaning is
  unchanged and Runs stay comparable; the gap down to `download.total` is
  explained by `siteAssets` in the Run report.
- `defects.discoveryLeak` keeps its meaning — a non-image URL in the *raw*
  capture — so the long-documented benign `detail.html` leak still shows up
  there. It is now also reported as a Site asset, and never downloaded.
- A non-image leak that cannot be explained as a Site asset is still flagged.
- `images/` holds Wallpapers only, which is what makes the Gallery total
  (ADR 0005) a clean number.
