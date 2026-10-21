# Discovery is the Gallery list, not a browser crawl

A Run used to render the wallpaper page in a persistent Chrome session, click
every thumbnail, and capture image responses until the network settled. That
never saw the gallery: the SPA renders a handful of thumbnails at a time, so the
capture covered **18–45%** of the site's own inventory (measured 0.1798 / 0.4496
/ 29.7%), and the number moved with the network, not with the gallery. The site's
list endpoint answers the same question in one request — every entry, every
`pictureUrl`, no session — in about 160 ms (ADR 0006).

Discovery is that request now. A Run's Wallpaper URL set is the list's URLs,
verbatim, and one Run covers the whole gallery. Everything that existed to render
the page is gone with it: the session clear, the browser launch, the run-code
payload and the loader that materialized it for `--filename`, the scroll
stability loop, the DOM merge, the Site asset filter on the Run's path, the
cookie extraction and the header that carried it. `@playwright/cli` and Google
Chrome are no longer prerequisites; the Console's prerequisite check keeps only
`env-file` and `tsx-entry`, and its orphan cleanup no longer closes a browser
session (there is none to close).

This closes the gate HISTORY.md recorded for option (C). The gate was
`discovery.coverage`: it was added in the 2026-09-15 gallery-list round as the
screening number for exactly this decision, measured over real Runs, and this
round is its result. The number is retired with its purpose — a coverage that is
`1` by construction measures nothing — and is kept in the report as `1` (or
`null`), not deleted.

## The report's contract

The Run report's shape does not change. `check-run`, the Console and the run-log
readers consume it, and the ticket requires the Run log format, the three-state
semantics and `check-run`'s exit codes to stay put. So every key stays, and each
one is re-pointed at the new reality:

- `discovery.coverage` is `1` when the list was read — the URL set is the list,
  so the share is complete by construction — and `null` when it was not. It no
  longer varies, and the ADR says so instead of removing it.
- `discovery.converged` means "the list request answered". `stableRounds`,
  `totalIdleSec`, `domCount` and `thumbnailsClicked` are `0`; `networkCount`,
  `combinedCount` and `discoveryDurationMs` are the list response's counters and
  its latency.
- `siteAssets` is present and empty (`{ count: 0, urls: [] }`). There is no
  capture left for the Site asset rules to filter; the rules themselves stay in
  `core/wallpaper-url.ts` as vocabulary, no longer on the Run's path.
- `defects.discoveryLeak` is `{ count: 0, urls: [] }` for the same reason.
- `defects.siteAssetFalsePositive` is `{ count: 0, urls: [] }` when the list was
  read — the check examined an empty drop list — and `null` only when the list
  was unavailable. It cannot be `null` while `mirrorGap` is non-null: the
  run-log reader ties those two, and a report that broke that invariant would be
  refused by every reader.
- `defects.emptyResult` now means "the list was not read" (there are no
  Wallpapers to download), and `defects.gallerySourceUnavailable` is set with it.
  The verdict is `defect`, so `check-run` still exits `1`; a clean list-driven Run
  is still `clean` (exit `0`) and a routine extra-on-disk file is still
  `explained` (exit `0`).

The keys that can no longer vary are kept rather than dropped on purpose: they
are read through the same schema the old logs satisfy, and "a field that no
longer means anything is present with an honest value" is cheaper to audit than
a contract that grew a version.

## Configuration and code

`PAGE_PATH`, `SESSION_NAME` and `PLAYWRIGHT_CONFIG` leave the schema, and
`run-meta` no longer records them; the page hash was never a key. The layered
read itself is untouched (that is #78's): an existing `.env` or `data/user.env`
that still carries them validates, because the schema ignores unknown keys. A
fresh install now needs one line:

```
BASE_ORIGIN=https://re.bluepoch.com
```

`scripts/run-discovery.js`, `core/discovery/discovery-loader.ts` and the
`.run-cache/` copy are deleted, together with their tests and the two tool-config
exclusions they needed (they were never ordinary source — see AGENTS.md of the
day). Discovery has one implementation of the list request,
`core/gallery/gallery-source.ts`, and one module that turns a list into a Run's
Discovery, `core/discovery/discovery.ts`, whose report fields are unit-tested.
Download lost `extractCookies` and the `Cookie` header; it keeps the 403 retry
with the full browser headers (that is the CDN's header policy, not auth), and
its contract is now proven by tests that inject the HTTP client.

## Considered options

- **Keep the browser capture as a fallback when the list fails**: rejected. Two
  URL sets in one Run is the duplicate representation ADR 0002 refused, and a
  capture that saw a third of the gallery is not a fallback — it is a reason to
  report the Run as defective and say so. The failure is now loud:
  `gallerySourceUnavailable`, `emptyResult`, no downloads, exit `1`.
- **Keep the browser capture and add the list as a second source**: rejected for
  the same reason, and it leaves the package's prerequisites (a global CLI and a
  Chrome install) in place to produce a number nobody should act on.
- **Keep `discovery.coverage` as a measured share (distinct names over the
  list)**: rejected. The URL set is every list URL, so the measure is constant;
  printing a computed `1.0` would suggest it might be less. It is `1` or `null`,
  and the ADR records why.
- **Drop the report keys that can no longer vary** (`siteAssets`, `stableRounds`,
  `discoveryLeak`, …): rejected. `check-run`, `web/api-types.ts` and the Console
  read the shape, the run-log reader refuses a report that does not carry it, and
  the ticket's acceptance is that the format does not move. An honest constant is
  cheaper than a contract version.
- **Report `siteAssetFalsePositive: null` because nothing is filtered**:
  rejected. `null` already means "the list was unavailable" in this block, and
  the reader's invariant ties it to the Mirror gap; using it for "nothing to
  check" would make every new Run report unreadable and every Run a defect.
  `{ count: 0, urls: [] }` is the honest vacuous answer.
- **Keep the payload and loader but stop calling them**: rejected. They exist
  only to feed `run-code`, they would keep the tool exclusions and the
  `.run-cache/` directory alive, and a dead payload invites someone to restore
  the crawl. Deleted with every reference.
- **Keep the cookie header for safety**: rejected. The CDN and the list answered
  anonymously (12/12 probes and the list itself, 2026-09-15), a session cookie is
  state the Run no longer owns, and download's tests now pin that no `Cookie`
  header is sent. The 403 retry remains as the CDN's header escalation.

## Consequences

- A single Run downloads the whole gallery the list describes. The old
  runbook traps — "a `combinedCount` below the Gallery total is expected", "low
  `coverage` means the scroll walk is doing less than it could" — are gone; the
  remaining reading is `gallery.mirror`, `download.failures` and the list's
  availability.
- The list endpoint is the Run's single point of failure and stays undocumented
  (ADR 0006). A failure is reported, never papered over, and nothing is
  downloaded: that is a defect, not a thin Run.
- `@playwright/cli` and Chrome are no longer required to run. The Console boots
  with no configuration and no network (the setup notice asks for `BASE_ORIGIN`);
  a start is refused only for `env-file` or `tsx-entry`.
- The Site asset rules keep their unit tests but lose their end-to-end check:
  `siteAssetFalsePositive` can no longer fire because no URL is dropped. They
  remain the vocabulary the Console's tile check reads, and deleting them is a
  separate question.
- Old Run logs, including the pre-#76 shape, keep parsing: the report contract
  did not move, and the reader accepts every key above either way.
- Unproven without a live Run: that two consecutive Runs produce the same entry
  count (the ticket's stability acceptance — the ~2 GB download is deliberately
  not run in this sandbox), and that the endpoint keeps serving the whole list
  with `pageSize: 2000`. The unit and integration tests prove the transformation,
  the report's round trip and the download contract, not the site's behaviour.

Related: ADR 0004 (the Site asset rules, now vocabulary only), ADR 0006 (the
gallery list is the source), ADR 0007 (the Run log is written synchronously),
ADR 0016 (the Console is the only human entry).
