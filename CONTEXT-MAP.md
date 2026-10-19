# Context Map

## Contexts

- **Discovery** — traverses the page and produces the raw capture.
  Owns: `scripts/run-discovery.js`, `core/discovery/discovery-loader.ts`; orchestrated by
  `core/main.ts` (steps 0–3). Vocabulary in CONTEXT.md → Discovery.
- **Download** — consumes the Wallpaper URL set and writes files to disk.
  Owns: `core/download/download.ts`; orchestrated by `core/main.ts` (steps 4–5).
  Vocabulary in CONTEXT.md → Download.
- **Gallery tracking** — the site's own inventory of the gallery, the mirror
  check against `images/`, and the cross-run memory of which entries have been
  seen.
  Owns: `core/gallery/gallery-source.ts` (the list endpoint),
  `core/gallery/gallery-state.ts` (`images/.gallery-state.json`); `core/main.ts`
  fetches the list once during discovery (step 3) and writes the state at the
  end of the Run (step 6). Vocabulary in CONTEXT.md → Gallery tracking.
- **Console** — the human entry point: a local service started by one command
  that serves a page reading the Run log directory, the Gallery list and the
  Mirror.
  Owns: `web/` — `web/server/` (the service and its entry point),
  `web/api-types.ts` (the type-only API contract the service and the page
  share), `web/src/` (the page), and the page's tooling (`web/vite.config.ts`,
  `web/tsconfig.web.json`, and the artifacts they produce: `web/dist/`, the
  thumbnail cache under `web/.console-cache/`); started by the `webui` script.
  Vocabulary in CONTEXT.md → Console.
- **Wallpaper URL set** (shared) — the vocabulary for what counts as a
  Wallpaper lives in `core/wallpaper-url.ts`, which both Discovery's output and
  Download's input pass through.

## Relationships

- **Discovery → Site asset filter → Download**: Discovery publishes the raw
  capture (bridged via `window.__wpUrls`); the Site asset filter in
  `core/wallpaper-url.ts` partitions it into Wallpapers and Site assets; Download
  consumes only the Wallpapers and writes them to `images/`.
- **Discovery → Download (shared)**: the Browser session's Session cookies are
  extracted after discovery and reused by Download for auth.
- **Gallery list → Site asset filter**: the list is the authority on what a
  Wallpaper is, so a URL the filter dropped that appears in the list is reported
  as a Site asset false positive (`null` when the list was unavailable, because
  not checking is not the same as finding nothing).
- **Gallery list ↔ Mirror**: the list is compared with the Wallpaper files on
  disk in both directions (missing / extra), which is what makes a Mirror gap
  visible.
- **Discovery → Gallery list**: `discovery.coverage` measures one Run's capture
  against the list.
- **Console → CLI entries**: the Console is the human entry point, and it starts
  a Run as a child process; `save-wallpapers` and `check-run` stay the
  agent-facing entries, with their names, exit codes and contracts unchanged.
- **Run log → Console**: the Console knows Runs by reading the Run log
  directory, never a handle it holds, so a terminal-started Run is visible and a
  restart loses nothing; the verdict it prints is `check-run`'s own
  parse-and-assess pair on the same newest log.
- **Mirror → Console**: the Console reads the Mirror's file names for the
  Wallpaper count and the gallery view, and writes nothing into it — the
  Mirror's one writer stays a Run.
- **Gallery list → Console**: the gallery view is one row per Gallery list
  entry, and it degrades to the Mirror alone when the list is unreachable,
  reporting the list as unread rather than as nothing missing.

## Where things live

| Concern              | File                             |
|----------------------|----------------------------------|
| Configuration (.env) | `core/config.ts`                  |
| Logging              | `core/logger.ts`                  |
| Wallpaper URL set / Site asset rules | `core/wallpaper-url.ts`           |
| Gallery list (site endpoint) | `core/gallery/gallery-source.ts` |
| Gallery state + Mirror gap | `core/gallery/gallery-state.ts` |
| Analysis/report      | `core/report/report.ts`           |
| Orchestration        | `core/main.ts`                    |
| Discovery script     | `scripts/run-discovery.js`       |
| Discovery loader     | `core/discovery/discovery-loader.ts` |
| Download + cookies   | `core/download/download.ts`       |
| Console service + entry point | `web/server/`            |
| Console API contract | `web/api-types.ts`               |
| Console page (Vue 3, built by Vite) | `web/src/`, `web/index.html` |
| Console tooling (bundler, type program) | `web/vite.config.ts`, `web/tsconfig.web.json` |
