# The annotated architecture

The annotated tree of this repository: `core/` the crawler, `web/` the Console,
and `scripts/` and `packaging/` for what does not travel with the program. Each
module gets one line — what it owns, and whether it is unit-tested — so this is
the authority the standards review cites for module ownership: open it before
moving a module, or before deciding which file owns a rule. The steering file
(`AGENTS.md`) keeps the orientation and the pointer to this document; the tree
moved here verbatim and is not summarised.

```
core/                        — the crawler
├── app-root.ts              — the two injected roots: RE1999_APP_ROOT / RE1999_DATA_ROOT or their caller fallbacks; nothing derives either from module position (unit-tested)
├── config.ts                — the pipeline's eager configuration: reads the two layers at import (an unusable pair fails a Run before it starts) and exports the constants the pipeline imports
├── config-read.ts           — the configuration schema's one home: parseConfig (strict) + readLayeredConfig (the Console's non-throwing read; app/.env over defaults, data/user.env over app), the data-relative defaults, the Gallery list URL, and the User-Agent default (no eager parse; re-exported by config.ts) (unit-tested)
├── data-layout.ts           — the arrangement inside the data directory: images/, logs/, cache/thumbnails/, the layout.json version marker, and the forward-only same-volume rename of a pre-#80 checkout (unit-tested; never deletes)
├── version.ts               — the one current version: the build-injected constant (`RE1999_VERSION`, ticket #84's define seam) with the app root's package metadata as the source run's fallback (unit-tested)
├── node-floor.ts            — the Node floor's one check: `engines.node` reaches the bundles as the `RE1999_NODE_FLOOR` define, and the Console refuses to start below it in one Chinese sentence before the handshake or a bound port (unit-tested; #117)
├── logger.ts                — pino: pretty console + synchronous JSONL Run log (ADR 0007)
├── main.ts                  — orchestration: ask the gallery list → download its URLs → check the list → report
├── check-run.ts             — the verdict CLI: newest Run log + Gallery state + file probe → print, exit 0/1
├── wallpaper-url.ts         — the Wallpaper URL set's vocabulary: isImageUrl, wallpaperNameOf, isWallpaperFile, Site asset rules, splitWallpaperUrls (unit-tested; the rules are vocabulary now, off the Run's path — ADR 0018)
├── run-log-file.ts          — the newest Run log's name and the file probe, shared by check-run and the Console (unit-tested)
├── discovery/
│   └── discovery.ts         — Discovery: turns the Gallery list into the Run's URL set and the report's counters/capture audit (the list request itself stays in gallery-source.ts; unit-tested)
├── download/
│   └── download.ts          — parallel batch downloads via undici (injected client and site inputs), no session, 403 retry (unit-tested)
├── gallery/
│   ├── gallery-source.ts    — the site's gallery list endpoint: fetch + validate (unit-tested)
│   └── gallery-state.ts     — cross-run id set + mirror check, writes <data>/images/.gallery-state.json (unit-tested)
└── report/
    ├── report.ts            — pure analysis: detectLeaks, classifyOutcomes, buildRunReport (unit-tested)
    └── run-log.ts           — the reverse: parseRunReport + assessRun, the three-state verdict (unit-tested)
web/                         — the Console, whole
├── index.html               — the page's entry document
├── api-types.ts             — the API contract the page and the service share: the payload types plus the code vocabularies (runtime tuples the dictionary test enumerates, ADR 0014)
├── uno.config.ts            — the design system: UnoCSS presets, semantic tokens, preflight (ADR 0013)
├── vite.config.ts           — the page's bundler config (root = this directory, output web/dist/)
├── tsconfig.web.json        — the page's type program (web/src/** + api-types.ts + uno.config.ts)
├── src/                     — the page (Vue 3). The entry and its views stay at this level — `App.vue`, `GalleryView.vue`, `RunPanel.vue`, `OrphanPanel.vue`, `FullSizeView.vue` — because they are what the page is; everything they compose lives in three buckets, one rule: reactive state or a lifecycle → `composables/`; a stateless pure function → `lib/`; markup only → `components/`
│   ├── components/          — markup only; flat, prefixed names; no feature subdirectories: `ConsoleNav` + `ConsoleUpdateNotice` + `LocaleSwitch` + `ConsoleDrawer` (the shell — the Exit lives on the nav, #96), `WallStart` + `WallHeader` + `WallTile` (the wall), `GalleryFigures` (the one figures line, rendered by both the header and the panel, #94), `RunSetupNotice` + `RunVerdict` (the Run panel)
│   ├── composables/         — the page's shared state: `useConsoleStatus` (one status read, the Run poll, the read on window focus), `useGallery` (the wall's one read — the page's one gallery snapshot), `usePageExit` (the page's one exit: exiting / awaiting confirmation / exited, #96), `useRunStart` (the page's one start action — only a click starts a Run)
│   ├── lib/                — stateless: `console-api.ts` (the only place a request carries the token), `masonry.ts` (the wall's columns — unit-tested), `poll.ts` (whether to read again), `gallery-figures.ts` (the one figures line: Gallery / downloaded / missing / extra — unit-tested), `run-panel.ts` (the counts line and the panel's one problem line, by priority — unit-tested), `wall-state.ts` (which band the wall is in, decided by the Mirror gap's missing count) + `run-start.ts` (what the start control is called — both unit-tested)
│   ├── i18n/                — the typed dictionary, the locale switch, the refusal's wording (ADR 0014)
│   └── console-token.ts     — the token the page was opened with, read from its own URL
└── server/                  — the service, and the one command that starts it
    ├── console.ts           — the entry point: resolve the app root, read the layers, refuse a tree missing its build artifacts, bind loopback, open it; also the process lifecycle — the page's exit and the terminal signal share one shutdown (say the Chinese, close, `exit 0`), and the exit copy is here (#96)
    ├── build-artifacts.ts   — what the shipped tree is made of: server.js / run.js / web/dist/index.html, the Run entry's path, and the boot refusal for a tree that lacks one (unit-tested; #84)
    ├── server.ts            — the app: the guard, the routes, the port fallback; re-exports the dependency contract from `http/deps.ts` so the contract keeps its import address
    ├── port-usable.ts       — the port decision: the fetch standard's blocked-port list, its usability predicate, and the refusal when no usable port is left (unit-tested; #131)
    ├── http/                — the transport's own parts: `deps.ts` (the injected contract), `guard.ts` (token/Host/Origin), `respond.ts` (the four response shapes and their exact headers), `method.ts` (405 + `allow`), `content-types.ts` (the extension→type table both the assets and the image routes read), `token-rewrite.ts` (the page and stylesheet rewrites), `assets.ts` (containment + serving one built asset)
    ├── routes/              — one file per route group (status, gallery, images, run, exit, instance, static); a route gathers inputs and translates a request-level refusal, but invents no status for a domain state
    ├── run-control.ts       — the Run launcher, the one-at-a-time rule, the stop decision, and the page's exit: `exitDecisionOf` (the same `stopDecision`, the caller's confirmation folded in) and `createExitController` (the kill of this Console's own tree, the scheduled shutdown) (#96)
    ├── instance-record.ts   — the handshake's file: the bound port + this boot's token in `<data>/instance.json`, its shape version and its ownership check (unit-tested; #82)
    ├── instance-handshake.ts — the second start's question: ask the record's address whether that service still answers, and hand back its page URL or `null` (socket-tested; #82)
    ├── unsafe-download.ts   — the `:Zone.Identifier` check and the Chinese unblock instruction a marked download prints (unit-tested; #85)
    ├── image-sizes.ts       — the Wallpapers' own pixel sizes, read for the masonry (unit-tested)
    └── …                    — the readers (Run log, Gallery list, Mirror, thumbnails)
tests/                       — mirrors the sources it tests
├── core/                    — the crawler's tests
│   ├── app-root.test.ts
│   ├── data-layout.test.ts
│   ├── data-cycle-survival.test.ts
│   ├── logger.test.ts
│   ├── config-read.test.ts
│   ├── version.test.ts
│   ├── node-floor.test.ts
│   ├── wallpaper-url.test.ts
│   ├── run-log-file.test.ts
│   ├── discovery/
│   │   └── discovery.test.ts
│   ├── download/
│   │   └── download.test.ts
│   ├── gallery/
│   │   ├── gallery-source.test.ts
│   │   └── gallery-state.test.ts
│   └── report/
│       ├── report.test.ts
│       ├── list-run-report.test.ts
│       └── run-log.test.ts
├── docs/                    — the tests whose subject is a committed document, not source
│   ├── adr-index.test.ts    — every ADR in docs/adr/ has an index line, and every line names one (#109)
│   └── readme-styleguide.test.ts — the style guide is committed and the steering file points at it (#125)
├── scripts/                 — the build's and the packager's own readings
│   ├── bundle-externals.test.ts
│   ├── package-layout.test.ts
│   ├── package-manifest.test.ts
│   ├── readme-docs.test.ts   — the README's facts and the licence's agreement (#121)
│   ├── release-notes.test.ts  — the changelog's extraction rule (#88)
│   ├── release-tag.test.ts    — the tag/version agreement (#88)
│   ├── unzip.test.ts
│   └── zip.test.ts
└── web/                     — the Console's tests
    ├── server/              — the service's tests (and their two helpers): the routes' surface, the exit's `409`/`202`s (`exit-api.test.ts`), the Run control and its lifetimes, the readers, the instance record and handshake
    └── src/                 — the page's tests
        ├── lib/
        │   ├── masonry.test.ts
        │   ├── poll.test.ts
        │   ├── console-api.test.ts
        │   ├── gallery-figures.test.ts
        │   ├── run-panel.test.ts
        │   ├── run-start.test.ts
        │   └── wall-state.test.ts
        └── i18n/
            ├── messages.test.ts
            └── vocabulary-guard.test.ts — every runtime tuple in web/api-types.ts is enumerated by the dictionary test or exempt with a reason (#112)
scripts/
├── check-branch.mjs  — pre-commit guard: refuse to commit on the default branch
├── build.ts          — the build: Vite's page + two esbuild entries (Console, Run) into `build/`, the `RE1999_VERSION` and `RE1999_NODE_FLOOR` defines, the tree's package.json, and a refusal when a bundle left an undeclared import
├── bundle-externals.ts — the build's two pure readings of esbuild's metafile: undeclared externals (`sharp` is the only allowed one) and the packages that did bundle (unit-tested)
├── boot-probe.ts     — the two boot checks' shared driver: the printed address, the `npm start` spawn, the child-process handle whose stop kills the whole tree, the tokenised request, and the status/exit guards (called by `smoke-boot.ts` and `package-check.ts`)
├── json.ts           — the one JSON-object predicate (`isRecord`) the scripts' readers share
├── package-version.ts — the one `package.json` version reader, shared by the build and the packager
├── package-layout.ts — the archive's whitelist and the packager's pure decisions: which root names may exist, the page's one wildcard, the required entries, the generated `.env`, and the lockfile's two decisions (unit-tested)
├── package-manifest.ts — the shipped manifest's one shape: version, the ESM marker, `engines.node`, `scripts.start` and `sharp`, plus the dependency reader the packager compares the generated lockfile against (unit-tested; #117)
├── package.ts        — `pnpm package`: collect the built tree, the document, the licence, the generated lockfile and config into `dist-package/re1999-wallpaper-crawler-v<version>.zip`, asserting the whitelist before the zip is written
├── package-check.ts  — `pnpm package:check` (#120): extracts the newest archive outside the repository, proves every path is the whitelist's and the extracted `.npmrc` is the generated one, `npm install`s it, boots it through `npm start` and probes `/api/status`
├── release-notes.ts  — the Release body: exactly one `## X.Y.Z` section of `CHANGELOG.md`, failing loudly when it is missing, empty or duplicated; CLI prints it or writes `--out` (#88, unit-tested)
├── release-tag.ts    — the tag/version agreement: a `vX.Y.Z` tag must equal `package.json`'s version, checked by function rather than inline YAML; CLI prints the version, `--package` is the dry run (#88, unit-tested)
├── smoke-boot.ts     — the boot check (#108, #119): stages a built tree into a temporary root, starts it through `npm start`, drives the page's own API with the boot token, proves a second start points back at the running page, and proves a tree missing an artifact refuses — `pnpm smoke:boot`
├── unzip.ts          — the release check's reader for the zip `scripts/zip.ts` writes: central directory → local header → deflate/stored, UTF-8 names, no zip64, and a name that could escape is refused (unit-tested)
├── webui.ts          — `pnpm webui`: runs `build/` as the program with the repository's `data/` as its data, so the developer's own Mirror and Run logs are what the page shows
└── zip.ts            — the hand-written zip writer (node:zlib, UTF-8 names, no zip64) (unit-tested)
packaging/
├── LICENSE.txt       — the MIT licence the packager ships at the archive root
└── site.env          — the committed site constants the packager writes as `.env`; the repository's own `.env` is the owner's and is never read by a release build
```

`LICENSE` at the root is MIT, with a plain statement that the wallpapers belong
to the official site and that this project stores or distributes none;
`package.json`'s `license` field is the same word rather than a second truth.
`tests/scripts/readme-docs.test.ts` pins that agreement.

`build/` itself is generated, never source: `pnpm build` writes it and
`.gitignore` keeps it out of the tree. It is a complete application root, which
is what a package ships (#86) and what `pnpm webui` runs.

`pnpm package` adds `dist-package/` (gitignored): one zip whose extracted root
**is the program root** — `README.md`, `LICENSE.txt`, `package.json`, the
generated `package-lock.json`, `.npmrc`, `.env`, `server.js`, `run.js` and
`web/dist/**` — with no `node.exe`, no `.bat`, no `node_modules\` and no
`data\`. `.env` is generated from `packaging/site.env`, never copied from the
working tree, and the lockfile is generated at package time against the shipped
manifest (the one step that needs the registry). The user's `npm install`
resolves `sharp`; the whitelist predicate and a real `pnpm package` run are what
keep a release from carrying the owner's data.

A Run's data lives in the data directory, never in the program directory: `<data>/images` (the Mirror), `<data>/logs` (the Run logs) and `<data>/cache/thumbnails` (the disposable thumbnail cache, outside the Mirror by ADR 0010), with `data/user.env` from #78. `core/data-layout.ts` owns that arrangement and the `layout.json` version marker; a pre-#80 checkout is migrated by a same-volume rename on the first start, and an unrecognised or newer layout refuses to start instead of guessing. The built tree (`build/`) is what travels with the program — two bundles and the page — and no source file does; there is no other root directory — the run-code copy that used to live in `.run-cache/` went with the browser crawl (#76). Nothing under the data directory is ever deleted by the program (ADR 0019).

Tests mirror the source tree under `tests/` (`core/report/report.ts` →
`tests/core/report/report.test.ts`, `web/server/server.ts` →
`tests/web/server/server.test.ts`, `web/src/lib/masonry.ts` →
`tests/web/src/lib/masonry.test.ts`); `vitest.config.ts` scopes collection to
`tests/**/*.test.ts`, so a test file left in a source tree never runs. There are
two deliberate exceptions. The service's surface has no per-file tests, because
what `routes/` and `http/` are is only meaningful as a whole — their tests are
the socket tests at `tests/web/server/`, which drive the bound service over a
real socket. And a test whose subject is a committed document rather than source
keeps the document's own name instead of a source path:
`tests/docs/adr-index.test.ts` guards the index over `docs/adr/`,
`tests/docs/readme-styleguide.test.ts` guards the guide's pointer from
`AGENTS.md`, and `tests/scripts/readme-docs.test.ts` guards the product
document's facts and the licence agreement.

**Discovery is the Gallery list** (ADR 0018, closing the gate ADR 0006 opened):
the site's own list endpoint returns every entry and every `pictureUrl` in one
unauthenticated request, and before #76 that list was only the authority the
browser capture was checked against. Now it *is* the URL set — one Run covers the
whole gallery — which also makes `gallery.officialTotal` exact and the
new-vs-known delta id-keyed. A Run has no browser, no session and no captured
traffic to filter; the Site asset rules in `core/wallpaper-url.ts` remain the
vocabulary for "is this a Wallpaper", off the Run's path.
