# The user's data lives in a data directory, and the program never deletes it

The package's promise is "unzip, double-click, watch it download", and its update
story is "replace `app/` wholesale". That story is false while the user's things
are in the program directory: a checkout keeps the Mirror at `images/`, the Run
logs at `logs/`, and the thumbnail cache at `web/.console-cache/`, so replacing
`app/` (or re-cloning) is the same act as throwing those away. #80 moves all
three under a data directory and makes the program's relationship to it
one-directional: it may create, add and rewrite states, never delete.

The layout is:

```
<data>/
  layout.json            the layout version marker ({"version": 1})
  images/                the Mirror
  logs/                  the Run log directory
  cache/thumbnails/      the disposable thumbnail cache
  user.env               the user's overrides (from #78)
```

`<data>` is an injected root, not a deduction: a source checkout resolves
`<repo>/data`, the package's launcher sets `RE1999_DATA_ROOT` to `<install>/data`
beside `<install>/app` (`core/app-root.ts`, #78). `core/data-layout.ts` owns the
arrangement inside it and is the only module that names it. The Mirror path
stays configurable (`IMAGES_DIR`), now resolved against the data root, because it
is the user's data and not the program's.

The thumbnail cache leaves the program directory for the same reason the Mirror
does: it is disposable, but 1000+ generated thumbnails are not free, and an
update that whitewashes them makes every first look slow again. It stays outside
the Mirror (ADR 0010) — `<data>/cache` is a sibling of `<data>/images`, so the
Mirror gap still depends on Wallpapers alone.

**The version marker is the "silent ignore" guard.** A program can meet data
written by a newer version — a downgrade, or an old copy of `app/` started after
an update. Without a marker the old program would `safeParse` the newer state
files into `null`, treat the Run as a first Run and show "official 1010 / local
0": the user sees "this software is broken" while nothing is reported. So
`layout.json` carries the layout version, and a newer (or unrecognisable) value
is a refusal to start with a Chinese explanation naming the marker file, not an
attempt to proceed. Nothing is created, moved or written before that refusal.

**Migration is by rename, on one volume, and idempotent.** A checkout that
predates #80 still has `images/`, `logs/` and `web/.console-cache/` under the
program root. On the first start of either entry (a Run, `check-run`, or the
Console), the three directories are renamed into the new positions, then the
marker is written. Three rules make that safe:

- **No deletes and no copies.** A same-volume `rename` is instant and lossless;
  `images/.gallery-state.json` moves with its Mirror and keeps `version: 1`
  (nothing reinterprets it). A failed run leaves the remaining source
  directories where they are, and the next start continues.
- **A target that already exists refuses.** If both the legacy directory and
  its new home exist, merging is a guess; the program stops with the two paths
  and exact manual steps, rather than picking one.
- **A different volume refuses.** A rename cannot cross disks; copying is not a
  silent fallback because "the disk was full halfway" would be a data loss mode.
  The refusal names both paths and says to move them by hand first.

An existing `layout.json` always wins over the legacy layout: once migrated, a
stray old directory is the user's to resolve, not the program's to move again.

**"Never delete" is a test, not a comment.** `tests/core/data-layout.test.ts`
drives the migration and every refusal on temporary trees;
`tests/core/data-cycle-survival.test.ts` runs the Run's whole data layer (logger,
Mirror mkdir, downloads, Gallery state write and read) against a migrated
temporary installation and asserts every pre-existing file still exists, byte for
byte, except the Gallery state a Run is allowed to rewrite;
`tests/web/server/data-survival.test.ts` drives the real Console over a socket
(status, gallery, image, thumbnail, refused start) and asserts the same. The
real checkout's 2.1 GB `images/` is never touched by the suite.

## Considered options

- **Leave the data at the repository root and document "don't delete it"**: the
  package replaces `app/`; documentation cannot make a deleted Mirror come back.
  Rejected — the separation is the only way the update promise is true.
- **Keep the thumbnail cache under `web/.console-cache/`**: it is disposable, so
  correctness does not require moving it, but every update would lose 1000+
  generated thumbnails and the first look after each update would be slow again.
  ADR 0010 only requires "outside the Mirror", which `<data>/cache` satisfies.
  Rejected.
- **Copy the legacy directories, then delete the old ones**: a copy can fail
  halfway; a delete after it makes the failure destructive. A rename is atomic at
  the directory level and leaves the old path intact when it fails. Rejected.
- **Cross-volume migration by copying**: same failure mode, plus a large Mirror
  and a disk-full window. The refusal with manual steps is honest. Rejected.
- **Merge a legacy directory into an existing new one**: two directories that
  both claim to be the Mirror may contain different Wallpapers and different
  Gallery state; a program that silently unions them can report a gap that is an
  artefact of the merge. Refuse and let the user decide. Rejected.
- **Ignore an unknown/newer `layout.json`** (fall back to defaults): this is the
  one failure the ticket names as unacceptable — "official 1010 / local 0" with
  no explanation. Rejected.
- **Put the marker inside `images/`**: it would be a dotfile in the Mirror, and
  the Mirror's arithmetic would depend on the exemption again (ADR 0010's
  reasoning). It lives directly under `<data>`. Rejected.
- **Version the layout in `data/user.env` or a hidden file**: a marker a user
  might edit as configuration is not a marker, and a hidden file is harder to
  show in a refusal. `layout.json` is visible and is not configuration. Rejected.

## Consequences

- A source checkout now keeps its data at `<repo>/data`, and `.env` still lives
  at the repository root as the shipped layer; `data/user.env` remains the user's
  override layer (#78). `.gitignore` ignores `data/` and still ignores the
  pre-#80 paths so an un-migrated checkout stays clean.
- ADR 0016's literal "the Console writes nothing into the repository root" is
  superseded: the program now creates `<data>/layout.json` and moves the user's
  data there on first start. Its constraint's intent stands and is stronger: the
  program writes nothing into its *program* directory, and the user's data is
  outside the directory an update replaces.
- ADR 0010 still holds: the thumbnail cache moved, but it is still outside the
  Mirror.
- ADR 0007 and 0009 still hold: `logs/` has a new parent, not a new format; the
  Run log readers and the newest-Run pick are unchanged.
- The Run report's shape is unchanged. Only path-valued `run_meta.config` entries
  (`IMAGES_DIR`, `LOG_DIR`, `GALLERY_STATE_FILE`) point at the new locations.
- A future layout change bumps `DATA_LAYOUT_VERSION` and adds a forward
  migration that may add or rewrite state files. It may not delete user data;
  the tests above are the gate.

Related: ADR 0006 (the Gallery state beside its Mirror), ADR 0007 (the Run log is
the audit trail), ADR 0009 (a Run's truth is its log), ADR 0010 (thumbnails
outside the Mirror), ADR 0016 (the Console writes nothing to the repository
root — superseded in letter by this decision), #75 (the package spec), #78 (the
injected roots), #80 (this work).
