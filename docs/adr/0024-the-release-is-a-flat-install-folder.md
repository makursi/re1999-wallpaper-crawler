# The release is a flat install folder, and `npm start` is the program

The portable package of ADR 0021 was a wrapper: a zip around `app\`, a bundled
`node.exe`, two `.bat` launchers, an in-program updater and a manual. Every part
of that wrapper existed to carry something the machine already had or could do
itself, and each part cost a seam: a 92.5 MB runtime in every release, a launcher
that had to stay pure ASCII and logic-free so its decisions moved back into the
program, an updater that was the repository's only module to recursively delete a
player-visible directory — and therefore needed an install pointer, a liveness
handshake, a path whitelist and a one-generation rollback — and a whitelist that
picked dependencies by hand. Spec #116 replaced the wrapper with a flat folder:
unzip it, `npm install` once, `npm start`.

This ADR records that shape, the boundary it collapses, the update it moves into
documentation, and the clauses of older ADRs it supersedes. Those ADRs are not
edited: they record the decision of their day, and the clauses named below are
superseded here rather than rewritten there.

## The shape

The archive's extracted root **is** the program root. It carries:

```
<install>\
  README.md            the one product document (#121)
  LICENSE.txt          packaging\LICENSE.txt
  package.json         the shipped manifest the build writes
  package-lock.json    generated at package time, against that manifest
  .npmrc               engine-strict=true
  .env                 generated from packaging\site.env
  server.js            the Console entry
  run.js               the Run entry
  web\dist\**          the page
```

and nothing else. There is no `app\` level, no `node.exe`, no `.bat`, no manual,
no `update.js`, no `node_modules\` and no `data\`; a release carries no source, no
test, no build script and no repository document beyond the README. `node_modules\`
appears when the player runs `npm install`; `data\` appears on the first start.

The shipped manifest is written by the build from the repository manifest, and
each field has one source: the version (the same reader the archive's name uses),
`engines.node` (the repository's floor), `scripts.start` (`node server.js`, no
arguments), and `dependencies.sharp` (the build's one allowed external). Every
other dependency is inside the two bundles, so `npm install` downloads exactly
what the program loads. `private: true` keeps the tree from being published by
accident, and `type: "module"` is what lets Node read the bundles as ESM.

The archive's contents are still a whitelist, and it is now a list of **names**
plus one wildcard: `README.md`, `LICENSE.txt`, the manifest, the lockfile,
`.npmrc`, `.env`, the two entries and `web/dist/**`. `scripts/package-layout.ts`
owns the predicate and `scripts/package.ts` asserts the collected paths before the
zip is opened, so a runtime binary, a dependency tree, a data directory, a source
file, a test or a hidden development configuration has no name it can enter
under. Adding a root entry is adding a line there and arguing for it.

The lockfile is **not committed**. A second lockfile in the repository would be a
second truth about what a release installs, and it would drift from the manifest
the build writes; the packager seeds a temporary directory with that manifest,
runs `npm install --package-lock-only` against the registry, checks that the
result names the manifest's dependencies, and plans it as an archive entry. That
is the packager's one network step, and it is stated in the script's own comment.

## The install folder is the program

ADR 0019 and ADR 0021 described two sibling roots: `<install>\app` for the
program, `<install>\data` for the player, with the launcher setting
`RE1999_APP_ROOT` and `RE1999_DATA_ROOT` because neither root could be derived
honestly. The flat folder collapses that: the install folder **is** the program
directory, and `data\` is its child.

- **The start is the manifest's script.** `npm start` runs `node server.js` with
  no arguments, and npm guarantees the package root as the working directory. The
  Console's existing working-directory fallback therefore resolves the program
  root as the install folder, and `dataRootOf()` defaults the data root to its
  `data` child — the same rule a source Run already used. No launcher, no new
  command-line argument and no new root variable. The environment variables stay
  the only override, for the source tree, `pnpm webui` and the tests.
- **The program writes only inside the folder.** `data\` — `layout.json`,
  `images\`, `logs\`, `cache\` and `user.env` — is created and versioned by
  `core/data-layout.ts` exactly as ADR 0019 decided. There is no install pointer
  and no `%LOCALAPPDATA%` write: the player extracted the folder and knows where
  it is, and the program's state is complete inside it. (The npm that runs
  `npm install` keeps its own cache in the user profile; that belongs to npm, not
  to this program.)
- **Uninstalling is deleting one folder.** Nothing outside it names the program,
  so there is no uninstaller, no service and no registry entry to clean up.
- **A second start still points back.** `<data>\instance.json` and the probe of
  ADR 0020 are unchanged: a second `npm start` over the same data directory opens
  the page that is already answering and exits, instead of starting a second
  service. Only npm is the parent process now; the record's identity is the bound
  port and this boot's token, not the parent's pid.
- **The Node floor is enforced twice from one source.** `engines.node` reaches
  the bundles as the `RE1999_NODE_FLOOR` define, and the Console's first check
  prints one Chinese sentence and exits 1 before the handshake or a bound port.
  The shipped `.npmrc` sets `engine-strict=true`, so npm refuses the install
  first. A player who bypasses the install check still cannot reach a page whose
  every thumbnail fails.

## The update is three documented steps

The program never replaces itself. An update is:

1. extract the new zip into a **new folder**;
2. stop the old program and move the old `data\` into the new folder;
3. delete the old folder after the new one has run.

There is no in-place overwrite, no file replacement protocol and no pointer. The
old folder is the rollback point: it still holds the previous program and its
dependencies, and rolling back is moving `data\` back and starting it. The data
layout does not change, so no migration code ships — only the paragraph in the
README.

This makes ADR 0019's "the program never deletes" stronger rather than weaker:
there is no longer any module that deletes a player-visible directory. A
recursive delete still exists in the packager and in test cleanup, but those
remove temporary directories the packager created, never an installation or its
data. Deleting the old folder is the player's own last step.

## The version, and the semver reading

The version is still one number, one source (`package.json`'s `version`) from the
tag through the build to the page, and the archive's name. ADR 0021's semver
reading stands with one addition:

- **MAJOR** when the data layout or the configuration keys stop being compatible
  — and also when **the way the program is installed and updated** stops being
  compatible. This release is `2.0.0` for that second reason: the old portable
  folder is not updated in place, and its `data\` moves by hand.
- **MINOR** for a new capability, **PATCH** for a fix, including a site redesign
  that broke the crawl.

## The clauses this supersedes

**ADR 0019 (`data-lives-beside-the-program`).** Superseded: the sentence that a
package's launcher sets `RE1999_DATA_ROOT` to `<install>/data` "beside
`<install>/app`", and the consequence that the player's data is "outside the
directory an update replaces" — there is no `app\` and no update that replaces a
directory. Everything else stands and is the reason this release needs no
migration code: the data directory owns `images\`, `logs\`, `cache\` and
`user.env`, `layout.json` is the version marker, a pre-#80 checkout migrates by
same-volume rename, an unrecognised or newer marker refuses to start, and the
program never deletes under the data directory.

**ADR 0020 (`one-program-one-service-one-window`).** Superseded: "The launcher is
ASCII-only and contains no logic" with its `cd`, two root variables,
`node.exe` and `pause`; "First start creates `data\` and records the
installation" in its `%LOCALAPPDATA%\re1999-wallpaper-crawler\install.json` half;
and the consequences that name `#86`'s byte-for-byte `.bat` copy, the bundled
`node.exe` and `#87`'s pointer read. The rest stands unchanged: one program, one
service, one window; the instance record and the probe; the random per-boot
token; the probe's own route; the Mark-of-the-Web notice with its Chinese unblock
steps (now checked over `server.js`, `run.js` and `web/dist/index.html`); and
closing the window as a stop, where the window is now the terminal that ran
`npm start`.

**ADR 0021 (`the-release-is-one-portable-zip`).** Superseded clause by clause:
the whole "The shape" section (the archive root's `启动.bat`, `更新.bat`,
`使用说明.txt` and `app\`; `node.exe`; three bundles; sharp's hand-picked
closure); the whole "Two directories, two owners" section (the sibling
`<install>\app` and `<install>\data`, the launcher's injected roots and the
install pointer); the whole "The update" section (the new folder's `更新.bat`, the
pointer or dragged path, the pre-rename checks, the `app.old\` generation and the
rollback); the "Windows x64" sentence that the launcher is a `.bat`; and "The
archive carries no licence file" — the archive now carries `LICENSE.txt`. Its
`packaging\` consequence (every `.bat`/`.txt` in it becomes a root file, and
`使用说明.txt` is the player-facing documentation) is superseded too: `packaging\`
now holds only the licence and the site-constants template, and the README is the
documentation. What stands: one archive serves install and update; the whitelist
is the release's safety property; `.env` is generated from `packaging\site.env`
and never read from the working tree; the version is one number; the semver
reading (amended above); the one anonymous update-check request; no seed pack; no
mirror; no single-file executable; `sharp` stays; and the release is built from a
clean checkout rather than the maintainer's working tree.

**ADR 0016 (`the-webui-is-the-only-human-entry`).** No launcher, updater or
pointer clause exists in it to supersede. Its "the Console writes nothing into the
repository root" letter was superseded by ADR 0019 and stays superseded: in the
flat package the program writes only its `data\` child, and the shipped `.env` is
still the packager's output from a committed template, not a guess. Its "the page
gains no stop control" clause was superseded by ADR 0022.

**ADR 0022 (`the-page-owns-an-exit`).** Superseded: the sentences that the
launcher stays ASCII and logic-free and that `启动.bat` gains a `pause` on the
success path. The exit itself stands unchanged — the route, the refusal code, the
shared shutdown, the kill of only this Console's own tree, the Chinese lines and
the exit code 0 — and the window whose closing is a stop is now the terminal that
ran `npm start`.

**ADR 0023 (`the-release-body-is-one-fixed-template`).** Not superseded. The
seven-section template, its fixed order and its gate stand; the `安装` example in
the changelog's header is updated to the flat four steps, and this release's
section is an instance of it.

## Considered options

- **Siphon a runtime per release anyway** (download or vendor `node.exe` and copy
  it into the archive): rejected. The machine already has Node, which is the
  premise of installing with npm; the runtime was 92.5 MB of every release, it
  had to be updated on its own schedule, and shipping it is what forced the
  launcher, the two injected roots and the ASCII-only `.bat` in the first place.
- **Keep a launcher as glue**: rejected. A `.bat` cannot carry a decision or a
  Chinese sentence reliably (ADR 0020's measurements), so every decision moved
  back into the program; what remained was a directory change, two environment
  variables and an `exec` — exactly what npm's package-root working directory
  already guarantees. A second entry point that only does what `npm start` does
  is a seam with no job.
- **Keep an in-place updater with an install pointer and a rollback generation**:
  rejected. It was the only module that recursively deleted a player-visible
  directory, and therefore needed a pointer outside the folder, a liveness
  handshake, a path whitelist, a rollback that can itself fail, and a
  generation-deep `app.old\` — all to perform an operation whose safe form is
  "extract elsewhere, move the data, delete the old folder". The three steps have
  zero deletes by the program and the old folder is the rollback.
- **Put a second lockfile in the repository**: rejected. It would be a second
  truth about the release's dependency resolution, and it would drift from the
  manifest the build writes. The lockfile is generated at package time from that
  manifest, and the packager refuses one that does not name its dependencies.
- **Ship `node_modules`**: rejected. It carries resolution rules, platform
  binaries and size into the archive, and makes every dependency change a manual
  whitelist edit — the maintenance cost spec #116 removed. `npm install` is the
  player's one dependency step, and `sharp` is the only thing it resolves.
- **Distribute through `npm i -g` or `npx`**: rejected for this release. A global
  install writes outside the folder, which contradicts "uninstalling is deleting
  one folder", and it needs a package registry presence and a name the project
  does not own. The zip is the one channel; the spec puts registry distribution
  out of scope.
- **Keep the in-package manual beside the README**: rejected. Two documents that
  describe the same install drift, and the manual was one of the files the
  launcher's removal took with it. `README.md` ships and is the only one.

## Consequences

- `pnpm package` assembles the flat archive from a clean build; a packaging
  machine needs Node and a reachable npm registry for the generated lockfile, and
  a player's machine needs Node at or above the floor and a reachable registry for
  the one `npm install`. Offline installation, a mirror and dependency vendoring
  stay out of scope.
- The release is Windows x64 only — `sharp`'s native half and the zip — and
  macOS/Linux artifacts stay out of scope. A launcher is no longer a
  platform-specific part, because there is no launcher.
- There is no automated update and no in-place update. The notice still links to
  the Releases page, and the player still downloads, extracts, moves `data\` and
  deletes the old folder. That is a smaller guarantee than an updater and a
  larger one than "re-clone and hope".
- The Node floor is enforced by npm and by the program, and the README states the
  number; a mismatched Node cannot produce a page whose thumbnails all fail.
- Closing the terminal that ran `npm start` is still a hard stop: the exit handler
  does not run, and the stale instance record is proved stale by the next start's
  probe. The page's Exit and the terminal signal still share one shutdown.
- `README.md` is the one product document and ships at the archive root; the
  developer command set stays in AGENTS.md, so the release does not teach
  `pnpm`, tests or builds.
- The Distribution vocabulary changes with the shape: the launcher, the updater
  and the install pointer are retired, the fallback point and the program
  directory are redefined, and `CONTEXT.md` carries the replacements.

Related: ADR 0016 (the WebUI is the only human entry; its letter stays
superseded), ADR 0019 (data lives in a data directory and is never deleted; the
sibling-root clause superseded), ADR 0020 (one program, one service, one window;
the launcher and pointer clauses superseded), ADR 0021 (the portable zip; its
shape, update and pointer clauses superseded, its semver reading extended), ADR
0022 (the page owns an exit; its launcher sentence superseded), ADR 0023 (the
release body's template, unchanged), #75, #84–#89, #116, #117–#122.
