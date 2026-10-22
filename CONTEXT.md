# Wallpaper Scraper — Project Context

A wallpaper scraper for Bluepoch's official wallpaper gallery (re.bluepoch.com).
It asks the site's own gallery list for every Wallpaper URL in one unauthenticated
request, then downloads them in parallel to disk. The repo is one project split
into two sub-domains — **Discovery** and **Download** — joined by the **Wallpaper
URL set**.

## Language

Every entry names its term in English, the language the code, the Run log and
the contracts are written in. The parenthesis carries the term's Chinese
canonical name — the word the bilingual interface says (`web/src/i18n/messages.ts`,
docs/adr/0014) — so a reader meeting 「镜像」 on the page can find Mirror here.

### Shared

**Wallpaper (壁纸)**:
An image the gallery lists, queued for download to disk. The Gallery list is
what decides this; the Site asset rules are the older vocabulary, kept for the
Console's tile check (ADR 0018).
_Avoid_: picture, background, 图片, 背景

**Wallpaper URL set**:
The deduplicated collection of Wallpaper URLs produced by Discovery and consumed
by Download. Since #76 it is the Gallery list's `pictureUrl`s, in the list's
order.
_Avoid_: URL list, allUrls, manifest

### Discovery

**Discovery**:
The sub-domain that produces the Wallpaper URL set. Since #76 it is one request
to the Gallery list, not a browser crawl (`core/discovery/discovery.ts`).
_Avoid_: scraping, crawling

**Site asset (站点资源)**:
A resource the page or the CDN serves alongside the gallery that is not a
Wallpaper: the page's own HTML document, analytics pixels, and the site's UI
art (page background, music-player covers, icons). Marked by the rules in
`core/wallpaper-url.ts`. Since #76 nothing captures those URLs, so the rules no
longer sit on the Run's path; they remain the vocabulary for "is this a
Wallpaper" (ADR 0004, ADR 0018).
_Avoid_: junk, noise, non-image (a Site asset can be an image)

**Site asset filter**:
The rule set that used to partition a browser capture into Wallpapers and Site
assets before Download. Off the Run's path since #76: the list is the authority,
so there is nothing to drop. Every Run still reports the empty result
(`siteAssets`, `siteAssetFalsePositive`) so the report's shape is unchanged.
_Avoid_: cleanup, sanitizer

### Gallery tracking

**Gallery list (官方清单)**:
The site's own inventory of the gallery, from its list endpoint: every entry
with the id the gallery numbers it by, plus the total. One request, no session.
It is the authoritative Wallpaper URL set — and since #76, a Run's Discovery.
_Avoid_: API, endpoint, manifest

**Gallery total**:
What the Gallery list says the gallery holds. Not a count of local files, and
it can fall when the site retires an entry. `null` when the list could not be
read.
_Avoid_: image count, total images, 图片总数

**Gallery state**:
The persisted record of the entry ids previous Runs have seen
(`<data>/images/.gallery-state.json`), which is what lets a Run report
`newSinceLastRun`. Ids are never forgotten: the site can retire an entry and
put it back, and forgetting it would report the re-appearance as new twice.
It lives beside the Mirror it describes and is deleted with it.
_Avoid_: cache, checkpoint

**New since the last Run**:
The entries whose id the previous Run's Gallery list did not carry — the answer
to "did the site publish anything?". `null`, not `0`, on a first Run: there is
nothing to compare against.
_Avoid_: delta, growth, 新增

**Mirror (镜像)**:
The local copy of the gallery — the Wallpaper files in `<data>/images/`, under
the user's data directory rather than the program's (ADR 0019).
_Avoid_: library, collection, dataset

**Mirror gap (镜像缺口)**:
A difference between the Gallery list and the Mirror: `missingFromDisk`
(official entries with no local file) or `extraOnDisk` (local files the list
does not contain — retired art, or junk the filter let through).
_Avoid_: diff, drift

**Discovery coverage (覆盖率)**:
The share of the Gallery list that one Run's URL set contained. Since #76 the
URL set *is* the list, so it is `1` whenever the list was read and `null` when
it was not — the number the old crawl was judged by (`18–45%`) is retired with
its purpose (ADR 0018).
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
(Accept, Sec-Fetch-*) because the CDN rejects minimal requests. It is header
policy, not auth: no session cookie is sent (ADR 0018).
_Avoid_: header escalation

### Console

**Console (本地控制台)**:
The repository's only human entry: one command starts a local service that
serves a page in the browser. The page starts and watches Runs, reads the newest
Run's verdict, and shows the Mirror against the Gallery list; it writes neither
the Mirror nor a Run log, and with no usable `.env` it still opens and says what
to create. It holds exactly one control over the program's life — an **exit**
(the page's Exit, beside the window), never a stop or pause of a Run alone: it
ends the whole program, and it asks first while a Run is in flight, by the same
rule as the terminal signal (docs/adr/0022). The command line — `core:run` and
`check-run` — is the agent's interface, not a user's path. Its HTTP surface is an
**adapter**, and that is the test of whether a change belongs there: it
*identifies* the caller (token, `Host`, `Origin`), *gathers inputs* (the injected
readers) and *speaks HTTP* (status codes, headers, bytes). Every judgement — one
Run at a time, an Orphaned Run's cleanup, the Mirror-against-Gallery gap, the
verdict, whether an exit must ask — stays in
the module that owns it, so a route never invents a status for a domain state;
translating a request-level refusal (a malformed name, a missing file) is the
route's, because that is the HTTP vocabulary itself.
See docs/adr/0008, docs/adr/0016, docs/adr/0017 and docs/adr/0022.
_Avoid_: GUI, dashboard, admin panel, web app

### Diagnostics

**Run (运行)**:
One invocation of the whole scraper, from the gallery-list request through the
download summary, producing one JSONL log and one Run report.
_Avoid_: execution, session run

**Run log (运行日志)**:
The one JSONL file a Run writes, from its first `run_meta` record to its
`run_report`. It is that Run's audit trail, so the Run is only verifiable
through it: a Run log that stops before `run_report` is a defect in the log,
**not** evidence that the Run failed. See docs/adr/0007.
_Avoid_: log file, log output, 日志

**Orphaned Run (孤儿运行)**:
A Run left over from an earlier session, identified from the Run log directory
alone: a log with a `run_meta`, no `run_report` and a recent modification time.
A state, not an error path — a missing Run report is a defect in the log, not
evidence that the Run failed (see docs/adr/0007). The Console reports it and can
clean it up, after which a new Run can start.
_Avoid_: stuck Run, zombie Run, dead Run, hung Run

**Run 稳定性 (Run stability)**:
The degree to which a single Run completes both pipelines and produces a
trustworthy outcome, measured by: whether the Gallery list answered, download
success rate, 403 retry rescue rate, and absence of anomaly signals. Cross-run
consistency is tracked for the Gallery total; the list-driven Run repeats
exactly what the list holds, so entry counts are expected to match across Runs.
_Avoid_: reliability, health

**Run parity (运行等价)**:
The standard for accepting a pipeline change: a post-change Run's `run_report`
structure must be byte-identical in shape to a pre-change baseline (same
fields, same contract), and its observable metrics — download counts, success
rate, list availability — must not materially regress. Used to prove an
implementation swap (e.g. module system, runtime) kept behavior equivalent.
_Avoid_: run quality, 运行质量, no regression

**运行缺陷 (Run defect)**:
An anomaly detectable from the log that shows the Run deviated from
expectations. Classes: discovery leak (empty since #76), convergence failure
(now: the list did not answer), empty result, persistent failure, empty file,
Site asset false positive (always empty when the list was read), gallery source
unavailable, mirror gap. Cross-run drift beyond the Gallery list is a future,
aggregation-phase class.
_Avoid_: bug, error, failure (as a blanket term)

**Run report**:
The single structured log record (`type: run_report`) that aggregates one
Run's stability signals, its Gallery numbers and Mirror gap, the (now
always-empty) Site asset section, Discovery's counters and coverage, and
detected defects, so an Agent can assess the run without re-parsing the whole
log. Its shape is a contract: #76 re-pointed fields without dropping any
(ADR 0018).
_Avoid_: summary, dashboard, report file

**run_meta**:
The first log record of a Run carrying runId, timestamps, and a config
snapshot, so cross-run analysis is not confounded by config drift.
_Avoid_: header, preamble

### Distribution

**Portable package (便携包)**:
The folder a player gets from the release zip: the program, its launcher, its
updater and its manual, with the player's own data beside them.
_Avoid_: installer, app, 安装包

**Program directory (程序目录)**:
The part of the portable package the program owns and an update replaces whole;
in the package it is `app\`.
_Avoid_: install directory, program folder

**Data directory (数据目录)**:
The part of the portable package that belongs to the player: the Mirror, the Run
logs, the cache and their overrides. No update writes to it, and deleting it is
the player's own act.
_Avoid_: storage, workspace, user folder

**Artifact (制品)**:
A built file a release carries — the Console entry, the Run entry, the updater
entry and the page — as opposed to source. A shipped program runs its artifacts
as they are and compiles nothing. Not the Release page's 下载文件, which is the
portable package those artifacts travel in (ADR 0023).
_Avoid_: build output, bundle, binary, 下载文件, assets

**Launcher (启动器)**:
The one file a player double-clicks to start the program; in the package it is
`启动.bat`.
_Avoid_: entry point, starter, shortcut

**Updater (更新器)**:
The one file a player double-clicks to replace the program directory with a newer
release; in the package it is `更新.bat`.
_Avoid_: installer, patcher, update package (the release is the package)

**Fallback point (回退点)**:
The previous program directory, kept beside the current one after an update so the
player can rename it back when a new version does not start. One generation only;
in the package it is `app.old\`.
_Avoid_: backup, snapshot, rollback

**Install pointer (安装指针)**:
The program's own note, outside the package folder, of where the installation it
last started from lives — so the updater can still find a folder that has been
renamed or moved.
_Avoid_: install record, registry entry, config

**Site-constants template (站点常量模板)**:
The committed source of the configuration a release carries: the game's site
constants, never the owner's local settings.
_Avoid_: .env, default config, sample config

**Release notes (发布说明)**:
The body of a Release, cut verbatim from one version section of `CHANGELOG.md`
and written to the fixed template that changelog's header states: seven `###`
sections in a fixed order, no preamble line, no personal pronouns. The release
job refuses a section that breaks it (ADR 0023).
_Avoid_: 正文, release description, notes

## Architecture

### The Gallery list is Discovery (the core principle)

Discovery is one unauthenticated request: `POST` the site's picture-query
endpoint with `{ current: 1, pageSize: 2000 }` and take every `pictureUrl`. The
list carries the whole inventory, so a Run's URL set is complete by construction
— no rendering, no scrolling, no network capture, no session (ADR 0018).

### Discovery pipeline

1. Ask the Gallery list (`core/gallery/gallery-source.ts`, one implementation).
2. Turn the list into the Run's Discovery (`core/discovery/discovery.ts`): the
   deduplicated URL set, the report's `discovery` block, and an empty capture
   audit.
3. A list failure is reported, never papered over: `coverage: null`,
   `gallerySourceUnavailable`, `emptyResult`, no downloads.

### Download pipeline

1. Download in parallel batches of `BATCH_SIZE`; skip files that already exist
   (Content-hash skip). No session cookie is sent.
2. On 403, retry once with full browser headers (403 retry).
3. Summarize ok / skipped / failed + total size on disk, then refresh the
   Gallery state from the same list: compare it with the Mirror and record the
   ids for the next Run.

## Gotchas

- **The report's shape is a contract, even where a field stopped varying**:
  `siteAssets` and `discoveryLeak` are always empty, `coverage` is `1` or
  `null`, and `siteAssetFalsePositive` is `{count: 0, urls: []}` whenever the
  list was read — not `null`, which means "the list was unavailable" and is
  tied to the Mirror gap by the run-log reader (ADR 0018).
- **A legacy `.env` still validates**: `PAGE_PATH`, `SESSION_NAME` and
  `PLAYWRIGHT_CONFIG` left the schema; zod ignores unknown keys, so an existing
  file with them keeps working and the keys simply mean nothing.
- **The list endpoint is undocumented**: a short or capped response is refused
  (`parseGalleryList`), not reported as "new" or "missing". The failure mode is
  loud: `gallerySourceUnavailable` + exit 1 from `check-run`.
