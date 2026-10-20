# Wallpaper Scraper

Download every official `重返未来：1999` Wallpaper from
[Bluepoch](https://re.bluepoch.com/home/detail.html#wallpaper), and browse what
you already have, from one local page.

The page is the app. It shows your Mirror (`images/`) against the site's own
Gallery list, starts a Run when you ask for one, and reads the newest Run's
verdict when it ends. A Run drives a real Chrome window through the gallery,
captures the images on the network layer, drops the site's own UI art, and saves
the rest in parallel.

## Quick start

Needs Node 22.22+, [pnpm](https://pnpm.io), and the Playwright CLI installed
once, globally:

```bash
npm install -g @playwright/cli
npx playwright-cli install
```

Then the project's dependencies:

```bash
pnpm install
```

Then one command:

```bash
pnpm webui
```

The first start builds the page; every later start reuses the build. The command
binds the service to loopback, prints the URL and opens it in your browser. That
page is the app.

Two flags: `--port` is the port to prefer (8791 unless you say otherwise; if it
is taken, a free port is chosen and printed) and `--no-open` prints the URL
instead of opening a browser. The URL carries a token minted for this start, and
the service answers nothing without it: it binds to loopback only, and it writes
neither the Mirror nor a Run log.

## The page

The wall is the whole catalogue — five columns, each Wallpaper at its own
proportions, uncropped. A Wallpaper the Gallery list names but you do not have
yet is an outlined placeholder rather than a broken image. When the Gallery list
was not read, the wall shows your Mirror's files alone and the caption says so:
"not read", never "nothing missing". When it was read, the caption counts what
the two disagree about — listed Wallpapers missing from the Mirror, and Mirror
files the gallery no longer holds.

Click a tile to open the original file from disk at full size, with zoom steps up
to 4× and Escape to close. The viewer names the gallery's id and the file name
together, so a Wallpaper can be read against a Run.

The floating header carries the Mirror count and the language switch. The page is
bilingual — 中文 and English, 中文 first — and every word follows the switch,
including the setup notice. The choice is remembered.

The Run panel (the 运行 button) starts a Run and shows the in-flight progress as
your Mirror's count against the Gallery total. When the Run ends it shows the
newest Run's verdict, its Gallery numbers, its Download numbers and one row per
defect class — or that none was found. It polls only while a Run is in flight.

An Orphaned Run — a Run log with no report that was written recently — is named
with its log and offered a cleanup. The cleanup closes the leftover Browser
session and withdraws the claim; it never edits or deletes the log, because the
log is the Run's audit trail. It is offered, not forced: the log directory alone
cannot tell a leftover from a Run that is still writing.

The wall and the header's Mirror count are read when the page loads. Reload after
a Run to see what arrived.

## Stopping

Ctrl+C in the terminal that runs the WebUI stops the service and, when the WebUI
started it, the Run's whole process tree — the loader, the browser CLI and
Chrome. With a Run in flight it asks first, and a "no" leaves both running.

There is deliberately no stop control on the page: closing the tab stops nothing,
because the page is a view and the Run's truth is its log on disk. The terminal
prompts are in Chinese.

## Configuration

You do not need `.env` to open the page. With no usable file it still serves the
wall, and the Run panel explains what to create — `.env` at the repository root —
with the two lines to paste. A Run is what refuses to start without it, rather
than guessing.

Only `BASE_ORIGIN` and `PAGE_PATH` are required. Everything else has a default,
so you can ignore this table:

| Variable | Default | Meaning |
|----------|---------|---------|
| `BASE_ORIGIN` | **required** | Site origin, e.g. `https://re.bluepoch.com` |
| `PAGE_PATH` | **required** | Gallery page path, e.g. `/home/detail.html` |
| `SESSION_NAME` | `bluepoch` | Browser session name: the persistent Chrome profile a Run uses |
| `IMAGES_DIR` | `images` | Where Wallpapers are saved |
| `BATCH_SIZE` | `4` | Parallel downloads per batch (1–20) |
| `LOG_DIR` | `logs` | Where the JSONL Run logs are written |

The service re-reads `.env` whenever it reads status and when a Run starts, so a
file created after `pnpm webui` clears the setup notice on the next status read —
reload the page — and a Run can start without a restart. The Gallery list is the
exception: its endpoint is fixed when the service starts, so a `.env` created
after boot leaves the list at "not read" until you restart `pnpm webui`. The wall
still shows the Mirror; it just cannot say what is missing.

## What a Run does

A Run first clears its Browser session — the named, persistent Chrome profile —
and reopens it, so it never inherits a previous Run's state. Then it walks the
gallery page: image URLs are captured at the network layer by a
`page.on("response")` listener, while the DOM is only scrolled and clicked,
because the gallery's virtual list unmounts whatever leaves the viewport. The
capture is filtered — icons, SVGs and the site's own UI art go away — and the
remaining Wallpapers are downloaded in parallel batches of `BATCH_SIZE`, reusing
the browser's cookies and retrying once with full browser headers when the CDN
answers 403.

Every Run also asks the site's own Gallery list (one POST, no login) for every
entry it holds. That list is the authority behind the Gallery total, the
new-since-last-Run delta and the Mirror check — and it is what proves the filter
kept the right things: a dropped URL the list calls a Wallpaper is reported, not
silently lost.

Don't click around in the Chrome window a Run opened — a stray click disturbs
discovery. Re-running is safe: files already on disk are skipped, so only new
Wallpapers are downloaded.

## Reading a run

Each Run writes one log to `logs/`, named `run-<runId>.jsonl`, where the id is
the Run's start time. Logs written under the older name are still read, so
history stays visible and the newest Run is found either way. The log's final
record is the Run report, the whole Run in one object; the page turns it into one
of three verdicts:

- **clean** — nothing was flagged.
- **explained** — only the routine classes were flagged: a discovery leak whose
  URLs are all Site assets the page itself served, or Mirror files the gallery no
  longer lists. They are named and recorded, not failed.
- **defect** — anything else: a crawl that did not converge or captured nothing,
  persistent download failures, empty files, a Site asset mistaken for a
  Wallpaper, a Gallery list that could not be read, listed Wallpapers missing from
  the Mirror, a claimed new file that is not on disk, or a Gallery state that
  names a different Run (or cannot be read).

"Not checked" is not "clean". When the Gallery list could not be read, the Mirror
gap is reported as not checked, and that is a defect: nothing may claim your copy
is complete on the strength of a reading that never happened.

A Run log that stops before its report is a defect in the log, not proof the Run
failed — an exit code of 0 does not prove the report was written.

That is the short version. The field-by-field reading — every number, every
reading trap — lives in the agent instructions: start at `AGENTS.md` → *Analyzing
a run's logs*.

## Development

| Task | Command |
|------|---------|
| Tests | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Format | `pnpm fmt` (check only: `pnpm fmt:check`) |

`AGENTS.md` is the developer and agent reference: the crawler's command line, the
conventions, the architecture and the gotchas. Vocabulary and the decisions
behind this tree live in `CONTEXT.md` and `docs/adr/`.
