# Context Map

## Contexts

- **Discovery** — traverses the page and produces the Wallpaper URL set.
  Owns: `scripts/run-discovery.js`, `src/discovery/discovery-loader.ts`; orchestrated by
  `src/main.ts` (steps 0–3). Vocabulary in CONTEXT.md → Discovery.
- **Download** — consumes the Wallpaper URL set and writes files to disk.
  Owns: `src/download/download.ts`; orchestrated by `src/main.ts` (steps 4–5).
  Vocabulary in CONTEXT.md → Download.

## Relationships

- **Discovery → Download**: Discovery publishes the Wallpaper URL set (bridged
  via `window.__wpUrls`); Download consumes it and writes Wallpapers to
  `images/`.
- **Discovery → Download (shared)**: the Browser session's Session cookies
  are extracted after discovery and reused by Download for auth.

## Where things live

| Concern              | File                             |
|----------------------|----------------------------------|
| Configuration (.env) | `src/config.ts`                  |
| Logging              | `src/logger.ts`                  |
| Analysis/report      | `src/report/report.ts` (+ tests) |
| Orchestration        | `src/main.ts`                    |
| Discovery script     | `scripts/run-discovery.js`       |
| Discovery loader     | `src/discovery/discovery-loader.ts` |
| Download + cookies   | `src/download/download.ts`       |
