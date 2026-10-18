---
name: save-images
description: Run the wallpaper scraper for the Bluepoch gallery. Use when the user wants to save or re-scrape wallpapers, run the discovery + download pipeline, or check whether a scrape run was clean.
---

# Save Images

The operating procedure for the wallpaper scraper: drive the Bluepoch gallery
through the browser, capture image requests on the network layer, download
the Wallpaper URL set to disk, and prove the Run was clean. The skill lives in
`.agents/skills/save-images/` — project-local, discovered by any agent harness
working in this repo, and it can fire on its own when the task matches or
when you name it.

## The run

A scrape is three steps; each ends on a state you can check.

**Preflight — machinery, access, and the user's hands.** Confirm
playwright-cli itself is installed: `npx playwright-cli --version` returns a
version. Do **not** probe an existing Browser session first — the pipeline
owns it (`src/main.ts` clears and reopens its own session: close-all +
delete-data + open --persistent), so `Browser 'bluepoch' is not open` from an
`eval` probe is the **expected** pre-run state, not a blocker. Login state
rides in the persistent profile, but it is not what makes the site readable:
the Gallery list and the CDN both answered anonymously in the 2026-09-15
probe (ADR 0006), so a logged-out session is not the first thing to suspect.
`.env` needs nothing from you: zod validates every key at startup and fails
fast.

A Run requires **full sandbox access on its first call**, and that is
structural, not environmental — ask for it up front instead of discovering it
by failing. Confined sandbox modes forbid named pipes, and two things in this
pipeline need one: every `playwright-cli` invocation in `src/main.ts` is
captured through piped stdio, and so is the esbuild service tsx starts, so
both die with `spawn EPERM`. pnpm may also need its store operation lock at
`%LOCALAPPDATA%\pnpm-store-operation-locks\all-stores.lock` — outside the
workspace — and fail with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` (os error
5, access denied). The approval reason is read by the user, so give them the
cause in the language they wrote their request in:

> The scraper captures every browser and compiler child process through
> pipes, which the confined sandbox forbids, and pnpm may need its store lock
> outside this workspace — it needs full sandbox access for the Run.

That buys one predictable approval at a moment you choose. The known
alternatives are dead ends, already measured — do not re-test them, and never
answer a denial with a "retry another way", which the harness rules forbid
outright (the 2026-10-18 session lost five calls to exactly that): another
launcher cannot avoid the pipes, because it is the pipeline's *own* children
that need them; `node node_modules/tsx/dist/cli.mjs` is the same tsx; and
`node src/main.ts` under Node's native type stripping dies at module
resolution, because the source imports siblings with `.js` specifiers Node
does not rewrite to `.ts` — which is why ESM with tsx stands (ADR 0003). The
measurements are in HISTORY.md.

The scrape drives a real headed Chrome for several minutes, so **ask the user
to leave the mouse and keyboard alone until the Run exits** — a stray click
or keystroke disturbs Discovery. That is a request you make of them, not a
precondition you can verify: nothing you can run tells you the machine is
clear.

_Done when playwright-cli answers, the user has been asked to leave the
machine alone until the Run exits, and the sandbox-access request for the
Run's first call is ready to send._

**Run — one command.** `pnpm save-wallpapers` (tsx runs `src/main.ts`).
Watch the terminal as hash injection, the Stability loop's rounds, the Site
assets it filters, and the download batches stream into
`logs/save-wallpapers-<ts>.jsonl`. Touch nothing until it exits.

_Done when the process exits 0, prints the ok / skipped / failed counts and
the Gallery total, **and has written a `run_report`** — an exit code of 0
alone is not proof of a clean Run (see the missing-report trap below)._

**Verify — the Run report.** Each Run writes one JSONL file in `logs/`
(`save-wallpapers-<runId>.jsonl`); read the newest. Grep `"type":"run_report"` —
one structured record with all metrics and the detected defects, the basis for
judging stability, finding defects and proposing optimizations. Two neighbours
set it in context: `"type":"run_meta"` carries the runId, the start time and the
config snapshot (to rule out config drift), and `"phase":"run-code"` carries the
Discovery diagnostics (`[stability]`, `[final]`, `[thumbnails]`) behind the
convergence numbers.

Judge the report block by block:

- **Discovery**: `discovery.converged` (`false` ⇒ not converged),
  `stableRounds`, `totalIdleSec`, `combinedCount` (the raw capture: every image
  URL, Site assets included), `discovery.coverage` — the share of the official
  list this Run's capture contained. Single digits to ~45% is normal: the page
  walk sees a small slice by design, and `coverage` says how small (`null` when
  the list was unavailable). The list endpoint always reaches 100%.
- **Download**: `download.successRate` = ok / (ok+failed),
  `download.rescueRate` = 403s rescued by retry, `download.failed`,
  `download.statusHistogram`, `download.failureGroups`.
- **Gallery**, read against the site's own list:
  - `gallery.officialTotal` — what the site says the gallery holds. `null` means
    the list call failed (`defects.gallerySourceUnavailable`), which makes every
    gallery number in this Run unknown rather than zero. It is the site's number,
    not a count of our files, and it moves: the 2026-09-04 "the gallery is
    exhausted at 971" reading was falsified when the 09-07 batch appeared.
  - `gallery.newSinceLastRun` — how many entries are new. `0` means the site has
    nothing new; a positive number answers "did it find anything?"; `null` means
    there is no earlier record to compare against (`firstRun: true`), which is
    **not** the same as 0.
  - `gallery.newFiles` — which entries those are.
  - `gallery.mirror` — the list against `images/`: `missingFromDisk`
    (`count`/`files`: Wallpapers we do not have) and `extraOnDisk`
    (`count`/`files`: files the list does not contain). Both 0 means the copy
    matches; `null` means it could not be checked.
- **Site assets**: `siteAssets.count` / `siteAssets.urls` — Site assets dropped
  before Download, which is *why* `download.total` is below
  `discovery.combinedCount`. Every drop is checked against the list, so a
  Wallpaper filtered by mistake shows up in `defects.siteAssetFalsePositive`
  instead; when the list was unavailable that check is `null` — not checked, not
  clean.
- **Defects**, auto-detected in `defects`, one class each: `discoveryLeak`,
  `nonConverged`, `emptyResult`, `persistentFailures`, `emptyFiles`,
  `siteAssetFalsePositive`, `gallerySourceUnavailable`, `mirrorGap`. Reading
  them: `emptyResult` is Discovery finding no Wallpapers at all — session logged
  out? page structure changed? read the `[final]` / `[thumbnails]` diagnostics.
  `nonConverged` / `discoveryLeak` — the Stability loop stopped early or network
  capture lagged. `persistentFailures` / `emptyFiles` are Download-side, and a
  `download.statusHistogram` full of 403s points at the session Cookie header,
  not the CDN. `siteAssetFalsePositive` and `mirrorGap` are `null` when the
  gallery list was unavailable, and `gallerySourceUnavailable` is the flag that
  says so: **not checked is not the same as checked-and-clean**.

Reading traps — the numbers that get misread:

- A re-scrape where every file already exists reports `download.successRate: 0`
  with everything skipped and 0 failed — that is **by design** (ok / (ok+failed),
  Content-hash skip), not a failure.
- `gallery.newSinceLastRun: null` is not "nothing new": it means no previous
  record existed (or the list was unavailable). Only `0` means the site added
  nothing.
- `mirrorGap: null` means **not checked** (the list was unavailable), not
  "clean"; `mirrorGap: { missing: 0, extra: 0 }` is the clean reading.
  `missing` = official entries with no local file; `extra` = local files the
  list does not contain (retired art, or junk the filter let through).
  `defects.siteAssetFalsePositive: null` reads the same way.
- A `combinedCount` below the Gallery total is expected and **not a defect**:
  the page renders only the thumbnails in view, so a Run sees a subset (that is
  what `discovery.coverage` measures). Read `gallery.newSinceLastRun` to tell
  "nothing new on the site" (0) from "the crawl regressed" — the latter surfaces
  as `nonConverged` or an empty capture, not as a small `combinedCount`.
- `combinedCount` grew by design on 2026-09-15 (172 → 484 in the same session):
  the Discovery script's own filter was removed, so the UI icons it used to drop
  invisibly now count as captured and show up in `siteAssets` (7 → 34).
- A `discoveryLeak` whose only URL is the page's own HTML URL
  (`re.bluepoch.com/home/detail.html`) is benign: it is also reported as a Site
  asset, is never downloaded and never counts toward the Gallery total; accept
  it, do not re-run for it. Every non-image URL is a Site asset by definition,
  so the leak list is a subset of `siteAssets.urls` — a leak that is not in
  there is the interesting one, because it means the rules need a look.
- **No `run_report` at all is a defect in the log, not proof the Run failed.**
  Run `2026-09-15T09-36-50` exited 0 and finished its work while every log
  record after the Site asset dump was lost, `run_report` included — the cause
  was the Run log's file target living in a pino transport worker, which can
  stop while the pipeline keeps going, and that is now gone (the Run log is
  written synchronously on the main thread, ADR 0007). A missing report still
  happens if the Run is killed or dies before its last step. When the report is
  missing, read `images/.gallery-state.json` **first**: its `runId` and
  `updatedAt` are written at the end of a Run, which separates "the Run
  finished, the log is gone" from "the Run never got that far". Then verify the
  outcome directly — fetch the official list and diff it against `images/` —
  rather than accepting the Run as clean on an exit code.
- **Cross-run trends**: compare `gallery.officialTotal` /
  `gallery.newSinceLastRun` / `download.successRate` / `defects` across files.
  The Gallery numbers are the cross-run signal (ADR 0006) — a drop in
  `combinedCount` alone says nothing. Aggregation beyond that is not yet
  automated.

Optimization leads to look for: low `rescueRate` ⇒ retry/header policy;
`failureGroups` dominated by one status ⇒ that status's handling; high
`avgDownloadMs` ⇒ batch-size/parallelism tuning; `nonConverged` ⇒ stability-loop
parameters or missing thumbnails; `gallery.mirror.missingFromDisk` ⇒ a Wallpaper
we do not have (the list carries the URL, so a re-download is possible);
`extraOnDisk` ⇒ junk or a retired entry; low `discovery.coverage` ⇒ the
scrolling walk is doing less of the work than the list endpoint could.

Accept the Run when no defect is reported, or record the decision for every
defect (accept / re-run / investigate) so the log stays the audit trail.

_Done when every defect is either absent or explained with a recorded
decision._

## Reference

The context around the run lives outside this file — this skill is the
operator's runbook, not the project's memory. The Run-log reading rules have no
second copy either: they are above, in **Verify**.

- **HISTORY.md** — why the pipeline is shaped this way, the approaches already
  rejected, and the open questions. Read it before trusting a defect as new.
- **CONTEXT.md** — domain vocabulary: Wallpaper, Wallpaper URL set, Site asset,
  Gallery total, Gallery state, Mirror, Mirror gap, Discovery coverage, Stability
  loop, Content-hash skip, 403 retry, Run log, Run report, Run defect.
- **docs/adr/** — decision history: 0001 network-first capture, 0002 run
  report in JSONL, 0003 ESM with tsx, 0004 Site asset filter, 0005 persisted
  gallery total (superseded), 0006 the gallery list is the source, 0007 the Run
  log is written synchronously.

## Invoking

- Any agent in this repo discovers the skill from `.agents/skills/` — the
  cross-agent convention honored by pi, Codex, Gemini CLI, and Cursor.
  (Claude Code reads `.claude/skills`; wire it via settings there if needed.)
- pi explicit form: `/skill:save-images`
- No arguments: the scraper's inputs come from `.env`.