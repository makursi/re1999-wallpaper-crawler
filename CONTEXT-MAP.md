# Context Map

## Contexts

- **Discovery** — traverses the page and produces the Wallpaper URL set.
  Owns: `scripts/run-discovery.js`, `src/discovery/discovery-loader.ts`; orchestrated by
  `src/main.ts` (steps 0–3). Vocabulary in CONTEXT.md → Discovery.
- **Download** — consumes the Wallpaper URL set and writes files to disk.
  Owns: `src/download/download.ts`; orchestrated by `src/main.ts` (steps 4–5).
  Vocabulary in CONTEXT.md → Download.
- **Gallery tracking** — cross-run memory of how many Wallpapers the official
  gallery has exposed, so each Run can report `newSinceLastRun`.
  Owns: `src/report/gallery.ts`, `logs/gallery-state.json`; refreshed by
  `src/main.ts` on both exit paths. Vocabulary in CONTEXT.md → Gallery total.

## Relationships

- **Discovery → Download**: Discovery publishes the Wallpaper URL set (bridged
  via `window.__wpUrls`); the Site asset filter in `src/wallpaper-url.ts`
  partitions that capture into Wallpapers and Site assets; Download consumes
  only the Wallpapers and writes them to `images/`.
- **Discovery → Download (shared)**: the Browser session's Session cookies
  are extracted after discovery and reused by Download for auth.
- **Discovery → Gallery tracking**: the Wallpapers Download leaves on disk are
  what Gallery tracking counts; it also needs Download's `ok` count to
  back-derive the previous total on a first Run.

## Where things live

| Concern              | File                             |
|----------------------|----------------------------------|
| Configuration (.env) | `src/config.ts`                  |
| Logging              | `src/logger.ts`                  |
| Wallpaper URL set / Site asset rules | `src/wallpaper-url.ts` (+ tests) |
| Analysis/report      | `src/report/report.ts` (+ tests) |
| Gallery total        | `src/report/gallery.ts` (+ tests) |
| Orchestration        | `src/main.ts`                    |
| Discovery script     | `scripts/run-discovery.js`       |
| Discovery loader     | `src/discovery/discovery-loader.ts` |
| Download + cookies   | `src/download/download.ts`       |
