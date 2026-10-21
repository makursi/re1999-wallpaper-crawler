# Context Map

## Contexts

- **Discovery** — asks the site's Gallery list and turns it into the Run's
  Wallpaper URL set.
  Owns: `core/discovery/discovery.ts`; orchestrated by `core/main.ts` (step 1),
  with the list request itself in Gallery tracking's
  `core/gallery/gallery-source.ts`. Vocabulary in CONTEXT.md → Discovery.
- **Download** — consumes the Wallpaper URL set and writes files to disk.
  Owns: `core/download/download.ts`; orchestrated by `core/main.ts` (step 2).
  Vocabulary in CONTEXT.md → Download.
- **Gallery tracking** — the site's own inventory of the gallery, the mirror
  check against the data directory's `images/`, and the cross-run memory of
  which entries have been seen.
  Owns: `core/gallery/gallery-source.ts` (the list endpoint),
  `core/gallery/gallery-state.ts` (`<data>/images/.gallery-state.json`); `core/main.ts`
  fetches the list once as the Run's Discovery (step 1) and writes the state at
  the end of the Run (step 3). Vocabulary in CONTEXT.md → Gallery tracking.
- **Console** — the human entry point: a local service started by one command
  that serves a page reading the Run log directory, the Gallery list and the
  Mirror.
  Owns: `web/` — `web/server/` (the service and its entry point, with the
  transport's own parts under `web/server/http/` and one file per route group
  under `web/server/routes/`), `web/api-types.ts` (the API contract the service
  and the page share: the payload types plus the code vocabularies the
  dictionary test enumerates, ADR 0014), `web/src/` (the page, in three buckets:
  `components/`, `composables/`, `lib/`), and the page's tooling
  (`web/vite.config.ts`, `web/uno.config.ts`, `web/tsconfig.web.json`, and the
  built page under `web/dist/`); started by the `webui` script. The thumbnail
  cache is not a Console artifact any more: it is `<data>/cache/thumbnails/`
  (ADR 0019).
  Vocabulary in CONTEXT.md → Console.
- **Wallpaper URL set** (shared) — the vocabulary for what counts as a
  Wallpaper lives in `core/wallpaper-url.ts`; Download's input, the Console's
  tile check and the mirror check all read it, while Discovery's URL set comes
  from the Gallery list (ADR 0018).

## Relationships

- **Gallery list → Discovery → Download**: the list is the Run's URL set
  (ADR 0018), so Download consumes exactly what the site lists and writes it to
  the data directory's `images/` (ADR 0019).
- **Gallery list → Site asset filter (vocabulary)**: the rules in
  `core/wallpaper-url.ts` still decide what a Wallpaper is for the Console's
  tile check, but nothing on the Run's path drops a URL any more, so the
  false-positive check is vacuous (`{count: 0, urls: []}`) whenever the list was
  read and `null` when it was not.
- **Gallery list ↔ Mirror**: the list is compared with the Wallpaper files on
  disk in both directions (missing / extra), which is what makes a Mirror gap
  visible.
- **Gallery list → Discovery**: one Run's URL set is the list, so
  `discovery.coverage` is `1` or `null` — kept as the gate's archive (ADR 0018).
- **Console → CLI entries**: the WebUI is the only human entry, and the Console
  starts a Run as a child process; `core:run` and `check-run` are the
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
| Configuration (.env) | `core/config-read.ts` (the schema + the Console's non-throwing read), `core/config.ts` (the pipeline's eager constants) |
| Logging              | `core/logger.ts`                  |
| Wallpaper URL set / Site asset rules | `core/wallpaper-url.ts`           |
| Gallery list (site endpoint) | `core/gallery/gallery-source.ts` |
| Gallery state + Mirror gap | `core/gallery/gallery-state.ts` |
| Analysis/report      | `core/report/report.ts`           |
| Orchestration        | `core/main.ts`                    |
| Discovery (the list → the Run's URL set) | `core/discovery/discovery.ts` |
| Download             | `core/download/download.ts`       |
| Console service + entry point | `web/server/`            |
| Console API contract | `web/api-types.ts` (types + code vocabularies) |
| Console page (Vue 3, built by Vite) | `web/src/`, `web/index.html` |
| Console tooling (bundler, design system, type program) | `web/vite.config.ts`, `web/uno.config.ts`, `web/tsconfig.web.json` |
