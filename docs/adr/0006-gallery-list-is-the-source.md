# Ask the gallery list for the gallery total and the known set

The gallery page renders only the thumbnails in view, so a Run captures a
subset of the gallery (`combinedCount` between 21 and 187 across 2026-09) and
no Run can count it. ADR 0005 answered that with a proxy: the number of
Wallpaper files on disk, carried forward with a monotone `max`. The proxy was
wrong in three ways the report could not show — it could not tell a newly
published Wallpaper from a file that had gone missing, one deletion or one junk
file that slipped past the Site asset filter made **every later delta 0**
(the stale high-water mark is never reached again), and it named a local file
count `officialTotal`, which is a claim about the site.

The site serves its own inventory. `POST
/activity/official/websites/picture/query` with `{ "current": 1, "pageSize":
2000 }` returns every entry (`id`, `title`, `pictureUrl`) plus `data.total`, in
one request, with no session and no cookies. A Run now asks for that list, and
the list is the source for:

- **`officialTotal`** — what the site says, so it can go **down** when the site
  retires an entry. If the call fails the Run reports `officialTotal: null` and
  a `gallerySourceUnavailable` defect; it never falls back to counting files.
- **`newSinceLastRun`** — entries whose `id` the previous Run's list did not
  contain. The state file holds the id set, next to the mirror it describes
  (`images/.gallery-state.json`); an id survives a re-encode, a filename does
  not.
- **The mirror check** — `images/` against the list in both directions
  (`missingFromDisk`, `extraOnDisk`). This is also what makes the Site asset
  filter checkable: `siteAssetFalsePositive` is a dropped URL that the list
  calls a Wallpaper.
- **`discovery.coverage`** — the share of the list a Run's capture contained.

## Considered options

- **Keep counting Wallpaper files on disk**: self-consistent and needs no
  network, but a count cannot tell "the site published nothing" from "we lost a
  file", and its monotone max hides that difference permanently. Rejected.
- **Parse the entry id out of Wallpaper filenames**: the leading number is not
  the id — 625 of the 1001 entries disagree with their filename, and ids 6-20
  carry no title at all. Rejected by measurement, not by assumption.
- **Capture the list response during Discovery** (accept `application/json` in
  the network listener): one transport, but it ties an authoritative number to
  a render that may never issue the request, and mixes two content types in one
  capture. Rejected.
- **Derive the delta from `run_report` history instead of a state file**: that
  is the duplicate representation ADR 0002 rejects. The state holds the id set,
  which the reports deliberately do not carry. Rejected.
- **Ask the list only for the total** (keep the file-count delta): makes the
  headline number honest and leaves the delta as wrong as it was. Rejected.

## Consequences

- `officialTotal` can decrease, `newSinceLastRun` is `null` (not `0`) on a
  first Run, and `mirrorGap` is `null` when the list was unavailable. "Unknown"
  is now representable in the report.
- The endpoint is undocumented and could change or start rate-limiting. The
  failure mode is loud: a `gallerySourceUnavailable` defect, and
  `parseGalleryList` refuses a list shorter than its own `total` rather than
  reporting the missing half as new.
- The mirror check makes both the filter's mistakes and any junk on disk visible
  as `extraOnDisk` — the end-to-end check `discoveryLeak` used to approximate.
- `discovery.coverage` is the number that decides whether rendering the page is
  still worth it next to asking the endpoint; HISTORY.md tracks that as an open
  question, not a settled one.
