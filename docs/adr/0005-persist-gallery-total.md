# Persist the gallery total across Runs

The gallery page renders only the thumbnails on screen, so a single Run
discovers a subset of the gallery (`combinedCount` was 21 on 2026-09-04 and 52
on 2026-09-14) while `images/` grew from 971 to 1001 files. No Run could answer
"how many Wallpapers does the official gallery have, and did this Run find
anything new?" — the only cross-Run record was grepping every `run_report` by
hand.

Every Run now refreshes a **Gallery total** — the number of Wallpaper files on
disk, i.e. everything the gallery has exposed so far — and records it in
`logs/gallery-state.json` next to the previous Run's value, so the next Run can
report growth. The same numbers are embedded in the Run report as `gallery`.

The total is `max(previous, current)` and never decreases, so a deletion or a
failed download cannot make the gallery appear to shrink.

## Considered options

- **Read the JSONL history instead of keeping state**: the Run report already
  carries each Run's numbers, so a state file can look like the second
  representation ADR 0002 rejected. But ADR 0002 objects to duplicating *one
  Run's* data; this is cross-Run memory, which ADR 0002 explicitly left as a
  future aggregation phase. The state file holds one small snapshot — the
  previous total — not a second history.
- **Use this Run's `combinedCount`**: it fluctuates with whatever the page
  happens to render, so it cannot answer "how many are there". Rejected.
- **Parse the index out of Wallpaper filenames** (the CDN numbers them, up to
  1012): unreliable — 1..1012 has 75 gaps and duplicates on disk. Rejected.
- **Count every file in `images/`**: simpler, but it counted the six Site
  assets until they were removed (ADR 0004). The count now filters on image
  extensions and trusts the Site asset filter to be the only thing keeping junk
  out of the directory.
- **Keep a history array in the state file**: duplicates the JSONL, which stays
  the canonical audit trail. Rejected; one snapshot is enough to compare.

## Consequences

- A first Run with no state file back-derives the previous total from that
  Run's *own* downloads (`previousOfficialTotal = officialTotal - download.ok`)
  and marks itself `firstRun` — but only that Run's growth survives. The
  upgrade Run on 2026-09-15 downloaded nothing (every Wallpaper was already on
  disk and hit Content-hash skip), so it recorded `newSinceLastRun: 0` although
  the previous Run had added 36; that growth lives only in the older Run
  reports. Nothing is lost from the second Run on: the delta is exact.
- Deleting `logs/gallery-state.json` costs one Run of comparison and nothing
  else.
- "Official total" means the *known* total: if the gallery ever retires a
  Wallpaper, the monotone max keeps counting it.
