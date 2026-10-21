---
name: save-images
description: Run the wallpaper scraper for the Bluepoch gallery. Use when the user wants to save or re-scrape wallpapers, run the discovery + download pipeline, or check whether a scrape run was clean.
---

# Save Images

The operating procedure for the wallpaper scraper: ask the Bluepoch site for its
gallery list, download the Wallpaper URL set to disk, and prove the Run was
clean. There is no browser in the pipeline — no Chrome, no `@playwright/cli`, no
session (ADR 0018). The skill lives in `.agents/skills/save-images/` —
project-local, discovered by any agent harness working in this repo, and it can
fire on its own when the task matches or when you name it.

## The run

A scrape is three steps; each ends on a state you can check.

**Preflight — machinery and access.** A Run needs a usable layered configuration
(`.env`, or `data/user.env`, with `BASE_ORIGIN`); zod validates every key at
startup and fails fast. `.env` needs nothing from you.

A Run requires **full sandbox access on its first call**, and that is
structural, not environmental — ask for it up front instead of discovering it
by failing. Confined sandbox modes forbid named pipes, and the esbuild service
tsx starts needs one, so the Run dies with `spawn EPERM`. pnpm may also need its
store operation lock at `%LOCALAPPDATA%\pnpm-store-operation-locks\all-stores.lock`
— outside the workspace — and fail with
`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` (os error 5, access denied). The
approval reason is read by the user, so give them the cause in the language they
wrote their request in:

> The scraper's tsx loader starts a compiler service through a pipe, which the
> confined sandbox forbids, and pnpm may need its store lock outside this
> workspace — it needs full sandbox access for the Run.

That buys one predictable approval at a moment you choose. The known
alternatives are dead ends, already measured — do not re-test them, and never
answer a denial with a "retry another way", which the harness rules forbid
outright (the 2026-10-18 session lost five calls to exactly that): another
launcher cannot avoid the pipes, because it is the pipeline's *own* children
that need them; `node node_modules/tsx/dist/cli.mjs` is the same tsx; and
`node core/main.ts` under Node's native type stripping dies at module
resolution, because the source imports siblings with `.js` specifiers Node does
not rewrite to `.ts` — which is why ESM with tsx stands (ADR 0003). The
measurements are in HISTORY.md.

_Done when `.env` is known to validate, and the sandbox-access request for the
Run's first call is ready to send._

**Run — one command, launched as a background job.** `pnpm core:run`
(tsx runs `core/main.ts`). This is internal tooling: the human path is the
WebUI (`pnpm webui`), which starts and watches the same pipeline from the
page, so send a user there rather than to this command. One request to the
gallery list (about a second) and the download batches stream into
`logs/run-<ts>.jsonl` — in the log, since a background job has no terminal to
watch. The Run has no browser child to outlive it, so the wrapper exits with the
Run; the proof is still the state, never the process exit code.

The proof is that state, never the process exit code. Three things say the Run
finished and are checked by one command, **`pnpm check-run`** (exit 0 for
`clean`/`explained`, 1 for `defect`): the Run log carries a `run_report`, the
Gallery state carries that report's `runId`, and the report's claimed new files
are on disk. A Run log that stops before its `run_report` is a defect in the
log, not evidence the Run failed — read `images/.gallery-state.json` first, as
the missing-report trap below says, which separates "finished, log lost" from
"never got there".

_Done when a `run_report` is in the Run log, the Gallery state carries the same
`runId`, and the claimed new files are on disk — `pnpm check-run` answers all
three, and the process exit code is not the proof either way._

**Verify — the Run report.** One command reads the newest Run log and prints the
Run's verdict: `pnpm check-run`. It compares the Gallery state's `runId` with the
report's, checks that the report's claimed new files are on disk with non-zero
size, passes the report's defect block through verbatim, and separates the
routine classes from the rest:

- `clean` (exit 0) — no defect at all.
- `explained` (exit 0) — only a `discoveryLeak` whose leaked URLs are **all**
  also in the report's `siteAssets.urls` (the subset rule; only older logs can
  produce one, since #76 records an empty leak), or only extra files on the
  Mirror (`mirrorGap.extra`, the routine retired-art case). They are still
  printed and named, so the decision gets recorded; the verdict only keeps them
  from reading as failures.
- `defect` (exit 1) — anything else, including a missing `run_report`, a Gallery
  state whose `runId` does not match (or an unreadable one), a claimed new file
  the check rejects, and every not-checked reading.

Gate on the exit code when you only need the verdict; read the output when you
need the numbers. It is `tsx core/check-run.ts` underneath, so it needs the same
sandbox access as the Run. When the output is not enough, read the log by hand:
each Run writes one JSONL file in `logs/` (`run-<runId>.jsonl`; Runs from before
the rename wrote `save-wallpapers-<runId>.jsonl`, and both count as a Run log);
read the newest. Grep `"type":"run_report"` — one structured record with all
metrics and the detected defects, the basis for judging stability, finding
defects and proposing optimizations. One neighbour sets it in context:
`"type":"run_meta"` carries the runId, the start time and the config snapshot (to
rule out config drift); the discovery-script records older logs carry
(`DISCOVERY_SCRIPT_SHA`, `"type":"discovery_script"`) went with the browser
crawl (#76) and are context, never a verdict input.

Judge the report block by block:

- **Discovery**: `discovery.converged` is now "the gallery list answered", and
  `discovery.coverage` is `1` whenever it did — the URL set *is* the list, so the
  old 18–45% screening number is retired (ADR 0018). `combinedCount` equals the
  list's entry count (shown next to `gallery.officialTotal`);
  `stableRounds`, `totalIdleSec`, `domCount` and `thumbnailsClicked` are `0` by
  construction. `coverage: null` means the list was not read, which also sets
  `gallerySourceUnavailable` and `emptyResult`.
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
- **Site assets**: `siteAssets.count` / `siteAssets.urls` — always `{0, []}`
  since #76, because nothing captures a URL to filter. `download.total` is
  therefore the list's count, and `defects.siteAssetFalsePositive` is the vacuous
  `{count: 0, urls: []}` whenever the list was read (`null` when it was not).
  `defects.discoveryLeak` is likewise always empty; a non-empty one in an old log
  predates #76.
- **Defects**, auto-detected in `defects`, one class each: `discoveryLeak`,
  `nonConverged`, `emptyResult`, `persistentFailures`, `emptyFiles`,
  `siteAssetFalsePositive`, `gallerySourceUnavailable`, `mirrorGap`. Reading
  them: `nonConverged` / `emptyResult` now mean the gallery list did not answer —
  read whether `gallerySourceUnavailable` is set, then check the endpoint by
  hand. `persistentFailures` / `emptyFiles` are Download-side, and a
  `download.statusHistogram` full of 403s points at the CDN's header policy (the
  403 retry), not at a session: no Cookie header is sent any more.
  `siteAssetFalsePositive` and `mirrorGap` are `null` when the gallery list was
  unavailable, and `gallerySourceUnavailable` is the flag that says so: **not
  checked is not the same as checked-and-clean**.

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
  list does not contain (retired art, or junk the old filter let through).
  `defects.siteAssetFalsePositive: null` reads the same way.
- `combinedCount` below `gallery.officialTotal` is **not** expected any more. It
  can only be lower if the list carried duplicate URLs (the URL set is
  deduplicated) — otherwise the two counts match, and a mismatch means the list
  changed between the Discovery step and the gallery-state step.
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
  `combinedCount` alone says nothing, and by construction it now equals the
  list. Aggregation beyond that is not yet automated.

Optimization leads to look for: low `rescueRate` ⇒ retry/header policy;
`failureGroups` dominated by one status ⇒ that status's handling; high
`avgDownloadMs` ⇒ batch-size/parallelism tuning; `gallery.mirror.missingFromDisk`
⇒ a Wallpaper we do not have (the list carries the URL, so a re-download is
possible); `extraOnDisk` ⇒ junk or a retired entry; a list failure ⇒ the
endpoint's availability/`pageSize`, not the render.

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
  Gallery list, Gallery total, Gallery state, Mirror, Mirror gap, Discovery
  coverage, Content-hash skip, 403 retry, Run log, Run report, Run defect.
- **docs/adr/** — decision history: 0001 network-first capture (retired by
  0018), 0002 run report in JSONL, 0003 ESM with tsx, 0004 Site asset filter,
  0005 persisted gallery total (superseded), 0006 the gallery list is the
  source, 0007 the Run log is written synchronously, 0018 Discovery is the
  gallery list, not a browser crawl.

## Invoking

- Any agent in this repo discovers the skill from `.agents/skills/` — the
  cross-agent convention honored by pi, Codex, Gemini CLI, and Cursor.
  (Claude Code reads `.claude/skills`; wire it via settings there if needed.)
- pi explicit form: `/skill:save-images`
- No arguments: the scraper's inputs come from `.env`.