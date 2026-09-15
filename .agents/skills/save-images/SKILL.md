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

**Preflight — machinery and machine.** Confirm playwright-cli itself is
installed: `npx playwright-cli --version` returns a version. Do **not** probe
an existing Browser session first — the pipeline owns it (`src/main.ts`
clears and reopens its own session: close-all + delete-data +
open --persistent), so `Browser 'bluepoch' is not open` from an `eval` probe
is the **expected** pre-run state, not a blocker. Login state rides in the
persistent profile, but it is not what makes the site readable: the Gallery
list and the CDN both answered anonymously in the 2026-09-15 probe
(ADR 0006), so a logged-out session is not the first thing to suspect.
`.env` needs nothing from you: zod validates every key
at startup and fails fast. The scrape drives a real headed Chrome for
several minutes, so clear the machine first: a stray click or keystroke
disturbs Discovery.

_Done when playwright-cli answers and the machine is clear._

**Run — one command.** `pnpm save-wallpapers` (tsx runs `src/main.ts`).
Watch the terminal as hash injection, the Stability loop's rounds, the Site
assets it filters, and the download batches stream into
`logs/save-wallpapers-<ts>.jsonl`. Touch nothing until it exits.

_Done when the process exits 0, prints the ok / skipped / failed counts and
the Gallery total, **and has written a `run_report`** — an exit code of 0
alone is not proof of a clean Run (see the missing-report trap below)._

**Verify — the Run report.** Open the newest `logs/save-wallpapers-*.jsonl`
and grep `"type":"run_report"` — one record per Run. Read its `gallery`
block against the site's own list:

- `gallery.officialTotal` — what the site says the gallery holds. `null` means
  the list call failed (`defects.gallerySourceUnavailable`), which makes every
  gallery number in this Run unknown rather than zero.
- `gallery.newSinceLastRun` — how many entries are new. `0` means the site has
  nothing new; a positive number answers "did it find anything?"; `null` means
  there is no earlier record to compare against (`firstRun: true`), which is
  **not** the same as 0.
- `gallery.newFiles` — which entries those are.
- `gallery.mirror` — the list against `images/`: `missingFromDisk` (Wallpapers
  we do not have) and `extraOnDisk` (files the list does not contain). Both 0
  means the copy matches; `null` means it could not be checked.
- `siteAssets.count` — Site assets dropped before Download. This is *why*
  `download.total` is below `discovery.combinedCount`; a Wallpaper that gets
  filtered by mistake shows up in `siteAssetFalsePositive` instead, because
  every drop is checked against the list. When the list was unavailable that
  check is `null` — not checked, not clean.
- `discovery.coverage` — how much of the list this Run's page walk reached.
  Single digits to ~45% is normal; the list endpoint always reaches 100%.
- `emptyResult` — Discovery found no Wallpapers. Session logged out? Page
  structure changed? Read the `[final]` / `[thumbnails]` diagnostics.
- `nonConverged` / `discoveryLeak` — the Stability loop stopped early or
  network capture lagged.
- `persistentFailures` / `emptyFiles` — Download-side. A
  `download.statusHistogram` full of 403s points at the session Cookie
  header, not the CDN.

Reading traps — the numbers that get misread:

- A re-scrape where every file already exists reports `download.successRate:
  0` with everything skipped / 0 failed — that is by design (ok / (ok+failed),
  Content-hash skip), not a defect.
- `gallery.newSinceLastRun: null` is not "nothing new"; it means no previous
  record existed (or the list was unavailable). Only `0` means the site added
  nothing. The same holds for `mirrorGap: null`, which means "not checked".
- A `discoveryLeak` whose only URL is the page's own HTML URL
  (`re.bluepoch.com/home/detail.html`) is benign: it is reported in its own
  right as a Site asset, is never downloaded and never failed; accept it, do
  not re-run for it. Every non-image URL is a Site asset, so the leak list is a
  subset of `siteAssets.urls` — a leak that is not in there is the interesting
  one.
- A `combinedCount` below the Gallery total is **not a defect**: the page
  renders only the thumbnails in view, so a Run sees a subset (that is what
  `discovery.coverage` measures). Before re-running, read
  `gallery.newSinceLastRun` — the site may simply have nothing new. The gallery
  total itself comes from the site's own list endpoint (ADR 0006), not from our
  copy, and it grows over time: the 2026-09-04 "the gallery is exhausted at
  971" reading was falsified when the 09-07 batch appeared.
- **No `run_report` at all is a defect in the log, not proof the Run failed.**
  Run `2026-09-15T09-36-50` exited 0 and finished its work while every log
  record after the Site asset dump was lost, `run_report` included — the cause
  was the Run log's file target living in a pino transport worker, which can
  stop while the pipeline keeps going, and that is now gone (the Run log is
  written synchronously on the main thread, ADR 0007). A missing report still
  happens if the Run is killed or dies before its last step. When the report is
  missing, read
  `images/.gallery-state.json` first: its `runId` and `updatedAt` are written at
  the end of a Run, which separates "the Run finished, the log is gone" from
  "the Run never got that far". Then verify the outcome directly — fetch the
  official list and diff it against `images/` — rather than accepting the Run as
  clean on an exit code.

Accept the Run when no defect is reported, or record the decision for every
defect (accept / re-run / investigate) so the log stays the audit trail.

_Done when every defect is either absent or explained with a recorded
decision._

## Reference

The context around the run lives outside this file — this skill is the
operator's runbook, not the project's memory:

- **AGENTS.md** — "Analyzing a run's logs": the full run-report reading
  workflow and the optimization leads.
- **HISTORY.md** — why the pipeline is shaped this way, the approaches already
  rejected, and the open questions. Read it before trusting a defect as new.
- **CONTEXT.md** — domain vocabulary: Wallpaper, Wallpaper URL set, Site
  asset, Gallery total, Stability loop, Content-hash skip, 403 retry,
  Run log, Run report, Run defect.
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