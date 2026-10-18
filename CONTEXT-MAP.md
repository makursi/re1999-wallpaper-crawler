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
  `src/gallery/gallery-state.ts` (`images/.gallery-state.json`); `src/main.ts`
  fetches the list once during discovery (step 3) and writes the state at the
  end of the Run (step 6). Vocabulary in CONTEXT.md → Gallery tracking.
- **Console** — the human entry point: a local service started by one command
  that serves a page reading the Run log directory, the Gallery list and the
  Mirror.
  Owns: `src/console/` (the service, the page, and the type-only API contract
  the two share); started by the `console` script. Vocabulary in CONTEXT.md →
  Console.
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
| Console (service + page) | `src/console/`               |
