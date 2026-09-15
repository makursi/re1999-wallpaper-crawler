# Context Map

## Contexts

- **Discovery** — traverses the page and produces the raw capture.
  Owns: `scripts/run-discovery.js`, `src/discovery/discovery-loader.ts`; orchestrated by
  `src/main.ts` (steps 0–3). Vocabulary in CONTEXT.md → Discovery.
- **Download** — consumes the Wallpaper URL set and writes files to disk.
  Owns: `src/download/download.ts`; orchestrated by `src/main.ts` (steps 4–5).
  Vocabulary in CONTEXT.md → Download.
- **Gallery tracking** — the site's own inventory of the gallery, the mirror
  check against `images/`, and the cross-run memory of which entries have been
  seen.
  Owns: `src/gallery/gallery-source.ts` (the list endpoint),
  `src/gallery/gallery-state.ts` (`images/.gallery-state.json`); refreshed by
  `src/main.ts` (step 6). Vocabulary in CONTEXT.md → Gallery tracking.
- **Wallpaper URL set** (shared) — the vocabulary for what counts as a
  Wallpaper lives in `src/wallpaper-url.ts`, which both Discovery's output and
  Download's input pass through.

## Relationships

- **Discovery → Site asset filter → Download**: Discovery publishes the raw
  capture (bridged via `window.__wpUrls`); the Site asset filter in
  `src/wallpaper-url.ts` partitions it into Wallpapers and Site assets; Download
  consumes only the Wallpapers and writes them to `images/`.
- **Discovery → Download (shared)**: the Browser session's Session cookies are
  extracted after discovery and reused by Download for auth.
- **Gallery list → Site asset filter**: the list is the authority on what a
  Wallpaper is, so a URL the filter dropped that appears in the list is reported
  as a Site asset false positive.
- **Gallery list ↔ Mirror**: the list is compared with the Wallpaper files on
  disk in both directions (missing / extra), which is what makes a Mirror gap
  visible.
- **Discovery → Gallery list**: `discovery.coverage` measures one Run's capture
  against the list.

## Where things live

| Concern              | File                             |
|----------------------|----------------------------------|
| Configuration (.env) | `src/config.ts`                  |
| Logging              | `src/logger.ts`                  |
| Wallpaper URL set / Site asset rules | `src/wallpaper-url.ts`           |
| Gallery list (site endpoint) | `src/gallery/gallery-source.ts` |
| Gallery state + Mirror gap | `src/gallery/gallery-state.ts` |
| Analysis/report      | `src/report/report.ts`           |
| Orchestration        | `src/main.ts`                    |
| Discovery script     | `scripts/run-discovery.js`       |
| Discovery loader     | `src/discovery/discovery-loader.ts` |
| Download + cookies   | `src/download/download.ts`       |
