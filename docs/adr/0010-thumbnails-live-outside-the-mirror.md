# Generate thumbnails outside the Mirror

The Gallery list's payload carries no thumbnail — twelve flat fields per entry,
of which `pictureUrl` is the only URL-valued one — and the CDN ignores resize
parameters (three variants checked on 2026-10-18, each returning the full byte
count). The Mirror's 1013 files are 3.5–3.9 MB at 1440×2560, so a grid of
full-size Wallpapers would cost tens of megabytes per screen. A tile has to be
derived locally.

Thumbnails are generated on demand, one size, longest edge 400 px with the
aspect preserved, and cached. The cache lives **outside** the Mirror.
`extraOnDisk` is computed from the Mirror's own file names, so a cache
directory inside `images/` is either reported as a Mirror gap or is invisible
only because of the dotfile exemption that the Gallery state file already
relies on. Either way the Console would be writing into the directory it exists
to describe, and the gap — the one number the page is for — would depend on
where the cache happened to sit.

The cache key is the existing Wallpaper naming vocabulary: a Wallpaper's name
embeds a content hash, so a cached thumbnail never needs invalidation. The
full-size view serves the original file rather than a second derived size. An
entry with no local file renders as a placeholder and is not fetched from the
CDN: the gap is closed by the next Run, so a network-backed tile would be cost
without a consumer. The image library is loaded lazily inside the Console only,
never by the crawler, so a broken or absent native binary cannot fail a Run.

## Considered options

- **Reuse a thumbnail from the site**: the list has no thumbnail field, and the
  CDN ignores resize parameters — measured against three variants, each
  returning the full byte count. Rejected by measurement, not by assumption.
- **Cache inside `images/`**, beside the Gallery state file: the state file is
  a dotfile and the mirror check skips dotfiles, so it would work today.
  Rejected anyway: it would tie the Mirror gap's arithmetic to a naming
  convention, and the Console would be editing the directory whose contents it
  is reporting. The cache belongs beside the Console, not inside the collection.
- **Pre-generate thumbnails in a batch**: the first open would wait on a job
  over a thousand 3.5–3.9 MB images. On-demand generation plus the cache keeps
  the first open to the tiles in view and still makes the second open fast.
  Rejected.
- **Serve a second derived size for the full-size view**: the original file is
  already on disk and is what "full size" means; a second size is a second cache
  key space for no new information. Rejected.
- **Fetch a missing entry's tile from the CDN** (a remote image instead of a
  placeholder): the Mirror gap is 0 today and is closed by the next Run, so a
  remote tile is cost without a consumer, and it would give a gallery row a
  second, network-dependent source of truth for its image. Rejected.
- **Let the pipeline generate the thumbnails**: importing the image library
  into the crawler would make a native-binary failure a Run failure, and would
  put derived files next to the Wallpapers. Rejected.

## Consequences

- Viewing the gallery edits nothing: the Mirror's Wallpaper count and the
  Mirror gap are unchanged by opening the page, and the Mirror keeps exactly one
  writer, a Run.
- A second visit to a Wallpaper does not regenerate its thumbnail; the first
  costs one decode of a 3.5–3.9 MB file.
- The Console needs a writable location outside the Mirror, and that cache is
  git-ignored.
- The image library is a Console-only import site — loaded lazily there, never
  imported by the crawler — so a scrape cannot be broken by it.
- One pinned size keeps the cache a single set of files; a second size would
  need its own key space and its own invalidation story.

Related: ADR 0006 (the mirror check this decision must not disturb), ADR 0008
(why the Console never imports the pipeline), ADR 0011 (the build artifact and
the cache, the two things that did not exist here before the Console).
