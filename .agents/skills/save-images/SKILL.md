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

**Preflight — session and machine.** Confirm the Browser session answers:
`npx playwright-cli -s=<SESSION_NAME> eval "location.host"` must return a
value — and it must be logged in; an anonymous session yields `emptyResult`
or 403s on every Wallpaper. `.env` needs nothing from you: zod validates
every key at startup and fails fast. The scrape drives a real headed Chrome
for several minutes, so clear the machine first: a stray click or keystroke
disturbs Discovery.

_Done when the session answers and the machine is clear._

**Run — one command.** `npm run save-wallpapers` (tsx runs `src/main.ts`).
Watch the terminal as hash injection, the Stability loop's rounds, and the
download batches stream into `logs/save-wallpapers-<ts>.jsonl`. Touch
nothing until it exits.

_Done when the process exits 0 and prints the ok / skipped / failed counts
and the size on disk._

**Verify — the Run report.** Open the newest `logs/save-wallpapers-*.jsonl`
and grep `"type":"run_report"` — one record per Run. Read it against the
project baseline (earlier runs' `combinedCount` and `download.successRate`):

- `emptyResult` — Discovery found no Wallpapers. Session logged out? Page
  structure changed? Read the `[final]` / `[thumbnails]` diagnostics.
- `nonConverged` / `discoveryLeak` — the Stability loop stopped early or
  network capture lagged; `combinedCount` sits below baseline.
- `persistentFailures` / `emptyFiles` — Download-side. A
  `download.statusHistogram` full of 403s points at the session Cookie
  header, not the CDN.

Accept the Run when no defect is reported, or record the decision for every
defect (accept / re-run / investigate) so the log stays the audit trail.

_Done when every defect is either absent or explained with a recorded
decision._

## Reference

The context around the run lives outside this file — this skill is the
operator's runbook, not the project's memory:

- **AGENTS.md** — "Analyzing a run's logs": the full run-report reading
  workflow and the optimization leads.
- **CONTEXT.md** — domain vocabulary: Wallpaper, Wallpaper URL set,
  Stability loop, Content-hash skip, 403 retry, Run defect.
- **docs/adr/** — decision history: 0001 network-first capture, 0002 run
  report in JSONL, 0003 ESM with tsx.

## Invoking

- Any agent in this repo discovers the skill from `.agents/skills/` — the
  cross-agent convention honored by pi, Codex, Gemini CLI, and Cursor.
  (Claude Code reads `.claude/skills`; wire it via settings there if needed.)
- pi explicit form: `/skill:save-images`
- No arguments: the scraper's inputs come from `.env`.