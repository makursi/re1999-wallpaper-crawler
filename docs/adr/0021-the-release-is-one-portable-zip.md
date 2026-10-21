# The release is one portable zip, and an update replaces only the program directory

A player's whole interface is a downloaded zip and two double-clicks: `启动.bat`
starts the program, `更新.bat` replaces it. Everything this repository decided
about distribution follows from those two gestures, and the package's shape is
the part a reader cannot recover from the code — the code knows *how* to swap
`app\`, not *why* the archive has no `data\`. This ADR records the shape, the
boundary, the update, the version and the one outbound request, with the
alternatives that lost, so the next ticket spends its arguments on new questions
(#75, #77).

## The shape

The archive's root is `启动.bat`, `更新.bat` and `使用说明.txt` beside `app\`, and
it contains no `data\` — that directory appears on the first start, created by
the program (ADR 0019). `app\` is the whole program: the bundled Node runtime
(`node.exe`, 92,534,088 bytes), three ESM bundles — `server.js` (the Console),
`run.js` (the Run child) and `update.js` (the updater) — the tree's
`package.json`, a generated `.env`, the prebuilt page under `web\dist\`, and
`node_modules` holding `sharp` plus the four packages its loader loads
(`@img/colour`, `@img/sharp-win32-x64`, `detect-libc`, `semver`). That is 240
files and 117.5 MB in the measured program tree, and `sharp`'s closure is the
only native thing that ships.

Nothing a player runs is source: no `tsx`, no Vite, no `node_modules` beyond
those five packages, no CLI entry. `core:run` and `check-run` stay repository
commands for developers and agents and are not in the archive. The page and the
Run entry are the same artifacts a built tree has (#84); the updater is the third
bundle because the update is the only operation that must be proved on real
folders, and a `.bat` cannot be (#87).

The archive's contents are a whitelist, not a checklist: `scripts/package-layout.ts`
allows exactly the root files, the three bundles, the page, the runtime and
sharp's closure, and `scripts/package.ts` asserts the collected list against it
before the zip is opened. The repository's own `.env`, `data\`, `build\`,
`web\dist\`, tests and scripts are refused by the same predicate. The `.env` a
release carries is generated from `packaging\site.env` — the committed site
constants — and never read from the working tree, so the owner's local
configuration has no path into a release.

One archive serves both a first install and every update. The player extracts it
somewhere, double-clicks, and later extracts a newer one and double-clicks
`更新.bat`; there is no installer, no service, no registry entry, and deleting
the folder is the uninstall.

## Two directories, two owners

`<install>\app` is the program's, `<install>\data` is the player's, and they are
siblings. The split is what makes "update" mean "replace the program" rather
than "replace your wallpapers": an update renames `app\` and puts a new one in
its place, so anything inside `app\` is disposable by construction. `data\`
holds the Mirror, the Run logs, the thumbnail cache and `user.env` (ADR 0019),
and nothing distributes it.

The data root is an **injected input**, never a deduction — the one mistake this
repository already paid for once (#78). The source tree alone has two answers: a
Run's program root is the repository, so its data is `<repo>\data`, a child; the
webui wrapper runs the built tree in `build/` with the data root pointed back at
`<repo>\data`, a sibling, because that is the shape a developer means to see —
the package's `<install>\app` beside `<install>\data`, reproduced
(`scripts/webui.ts`). The package keeps its data at `<install>\data`, a sibling
of `<install>\app`. No rule covers all three: "the sibling of the program root"
puts a Run's Mirror outside the checkout, "the child of the program root" writes
`<build>\data` into the directory `pnpm build` recreates, and a bundled module
has no meaningful depth at all — so "derive it from where this file is" fails in
exactly the tree that ships, and it fails quietly: the page opens, and only a Run
then cannot find its configuration. The launcher therefore sets both roots
explicitly, and the entry point resolves them once from the environment — the
working directory is the source tree's fallback, never the package's answer.

The install pointer solves the other half of "where am I": the folder can be
renamed or moved after the player unzips it, so every start rewrites
`%LOCALAPPDATA%\re1999-wallpaper-crawler\install.json` with the installation root
and the updater reads that. It cannot live inside the folder it names — a file
that moved with the folder cannot say where the folder went. Only the package's
`<install>\app`-beside-`<install>\data` shape writes it; a source checkout has no
installation to point at and never touches AppData.

## The update

The player downloads the new zip, extracts it *somewhere else*, closes the
running program, and double-clicks the new folder's `更新.bat`. The updater runs
from the new package, finds the old installation through the pointer (or through
the path the player dragged onto the `.bat`), and swaps one directory.

Every check happens before the first rename: the package root must not be the
installation and its `app\` must not overlap it; the target must exist and hold
both `app\` and `data\`; the new `app\` must carry `server.js`, `run.js`,
`update.js`, `node.exe` and `web/dist/index.html`; and no Console may be
answering from that installation — Windows lets a running image be renamed but
not deleted, so half an update is possible exactly where a window is still open.
Each refusal has its own Chinese sentence and its own next step.

Then: remove the previous `app.old\`, rename `app\` to `app.old\`, copy the new
`app\` in. The rename is the point of no return; anything that fails after it is
rolled back, and a rollback that itself fails names where the old program still
is instead of claiming success. The new tree is copied rather than renamed
because the extracted package and the installation are often on different
volumes, and leaving the extracted folder intact costs nothing. `app.old\` is
exactly one generation — the next update removes it — and nothing reads it on its
own: an automatic rollback across runs would silently downgrade a version that
works over one temporary error, which is a worse failure than a failed update.
Rolling back is the manual rename the manual describes.

Nothing deletes `data\`, and the guarantee is code, not copy: the updater can
resolve only the names `app` and `app.old` (`programTreePath` throws on anything
else), and its tests drive a real temporary installation through a successful
swap and a failed one and assert `data\` byte-identical afterwards. This is the
only module in the program that removes a player-visible directory, so it is the
only one that needs the guard.

## The version

One number, one source: `package.json`'s `version`. The build injects it into
both bundles (`RE1999_VERSION`), writes `app\package.json`, and the packager
names the archive from it; the status payload carries the same number and the
page prints it. The number on the page, in `app\package.json` and in the zip's
name therefore cannot drift, and a player reporting a problem can quote it.

The tag is `vX.Y.Z`, and the rule is semver with one deliberate reading:
**MAJOR** when the data layout or the configuration keys stop being compatible
(the `layout.json` refusal is the honest consequence), **MINOR** for a new
capability, **PATCH** for a fix — and **a site redesign that breaks the crawl is
a PATCH**, because to the player it is "broken → fixed", not a new capability.
The first public release is `1.0.0`. The tag names the version; the release's
notes are written for the player who reads them.

## The one request

The program makes exactly one outbound request that is not the game's site or its
CDN: an anonymous `GET` of GitHub's latest-release endpoint, once per boot, with
a three-second timeout and `redirect: 'error'`. Every failure — offline, DNS, a
non-200, a redirect, a body that is not JSON, a payload whose fields are not what
the API documents, a tag that is not `vX.Y.Z` — collapses to "no notice". A draft
or prerelease is never announced. A status read that lands while the check is in
flight simply carries no notice, and the next poll picks it up.

Nothing is downloaded, replaced or asked. The notice is a version and a link to
the Releases page; the reader's action is the download, and the update is a
different gesture. The repository is public because the unauthenticated endpoint
needs no token, and a token must never ship in a client.

## Windows x64, GitHub Releases, and the costs accepted

The archive is Windows x64 only: `node.exe` is the Windows runtime, `sharp`'s
native half is `@img/sharp-win32-x64`, and the launcher is a `.bat`. There is no
macOS or Linux artifact. The only channel is GitHub Releases; the notice links
there and nowhere else.

Those are accepted costs, not oversights: GitHub may be unreachable or slow in
China and there is no mirror to fall back on; an offline machine never learns a
newer version exists and may stay old indefinitely; and the first Run downloads
the gallery itself (about 2 GB) because no seed pack ships. Each was weighed
against a cheaper-looking alternative and is rejected below.

The licence is MIT. The wallpapers belong to the official site, and the tool
neither stores nor distributes them; the manual that is the archive's only
document says so. The archive carries no licence file — the repository's
`LICENSE` is the licence, and the manual carries the reader-facing statement.

## The amendment to ADR 0016

ADR 0016 said the Console writes nothing into the repository root and that the
user creates `.env`. In the shipped shape both sentences are false, and this ADR
is where that is recorded rather than silently departed from. 0016 is not
edited: it records the state of its day, like every ADR here.

- **The user does not create `.env` in the package.** `app\.env` is generated at
  pack time from `packaging\site.env` and ships with the program, so a player's
  first start is configured and the setup notice never fires. The Console still
  does not write it — the packager does, once, from a committed template, and the
  template is the site's constants rather than anyone's local settings. The
  owner's overrides remain `data\user.env`, which no update replaces.
- **The program does write beside itself.** `data\` is created and versioned
  (`layout.json`, `instance.json`) and the `%LOCALAPPDATA%` pointer is written on
  every start. In a source checkout `<repo>\data` is a child of the repository
  root, which is the literal thing 0016 forbade; ADR 0019 already superseded that
  sentence, and this ADR records the pointer's half.

In 0019's word, the letter is superseded; the intent is not, and is now stronger.
The program writes nothing into its *program* directory — the directory an update
replaces — and it never invents the configuration it runs with: the shipped
`.env` is a committed template's output, not a guess, and the user's own layer is
theirs. The page still has no stop control, and stopping is still not something
the page does (ADR 0020): closing the window is.

## Considered options

- **Ship a seed wallpaper pack in the archive**: rejected. It would remove the
  first Run's 2 GB download, and it would make every release carry the site's
  images — the one thing the licence and the manual promise this project does not
  do. The archive would grow to the gallery's own size, be re-uploaded for every
  PATCH, and be stale the day after. The first download is the price of the tool
  not being a distributor.
- **Automatic updates (download and self-replace)**: rejected. Windows does not
  let a running image be deleted, so the program would replace itself only from a
  second process, with the updater's whole refusal list attached; and it would
  take the choice away from the player, who is told when a new version exists and
  decides when to fetch it. The update stays a download the player makes and a
  double-click they perform.
- **A mirror download channel**: rejected. A mirror is hosting the project does
  not have and a second place a zip can come from; the notice offers no mirror
  entry, and the release page is the one address. The accepted consequence is
  stated above, not hidden.
- **A single-file executable instead of a folder**: rejected. `sharp`'s native
  `.node` must exist on disk to be loaded, so a self-extracting exe would unpack
  itself on every start (or into a temp directory the data model and antivirus
  would both fight); and the folder is what lets the manual say "update replaces
  `app\`, your data is in `data\`" and lets a player look inside. One exe also
  leaves the ASCII launcher and the injected roots with nothing to do, without
  removing what they exist for.
- **Drop `sharp` and serve the originals**: rejected, measured. 200 tiles served
  as originals cost about 418 MB of transfer and 2.4 GB of decode, and `sharp`
  also reads the pixel dimensions the wall needs before a thumbnail arrives. A
  native module is the price of the wall being usable, and it is one module.
- **Build the release on the maintainer's machine**: rejected. The machine's
  state is exactly what a release must not depend on, and the failure it produces
  — a package assembled from a working tree that carries the owner's data — is
  what the whitelist exists to make impossible. The packager takes its Node
  runtime as an input (`RE1999_NODE_EXE`) so a clean checkout can supply the
  official one, and the human's remaining job is the smoke test of the draft
  asset, not the build.
- **Ship two archives (a full one and an update-only one)**: rejected. One zip
  already serves install and update, and the updater validates a complete `app\`
  anyway; a second archive would be a second thing to build, assert and keep in
  step, and it would reintroduce the question "which one do I download?" that the
  single zip removes.

## Consequences

- The package is assembled by `pnpm package` (`pnpm build` + `scripts/package.ts`)
  into `dist-package/re1999-wallpaper-crawler-v<version>.zip`. #88's release
  pipeline runs the same assembly from a clean checkout on a tag and drafts the
  Release; until it lands, the same command is run by hand, and the archive it
  produces is the same one.
- The whitelist is the release's safety property, so a new file in the package is
  a change to `scripts/package-layout.ts` with a reason, never a copy line in
  `package.ts`.
- `packaging\` is the archive root's source: every `.bat`/`.txt` directly in it
  becomes a root file, and `使用说明.txt` is the player-facing documentation,
  carried with the BOM and CRLF Notepad needs (#89).
- A release carries no developer tooling, no CLI entries and no data; a packaged
  start is still the launcher's `cd` and the two roots, and the Console refuses a
  tree missing its artifacts before binding a port.
- The update is manual, one generation deep, and never automatic. That is a
  smaller guarantee than a real updater and a much larger one than "re-clone and
  hope"; the spec accepted the former.
- The data-layout marker is what makes the MAJOR rule enforceable: a newer
  `layout.json` refuses to start rather than being guessed at (ADR 0019).

Related: ADR 0016 (the Console is the only human entry; amended here, not
edited), ADR 0019 (data lives beside the program and is never deleted), ADR 0020
(the launcher, the single instance and the window as the stop control), ADR 0011
and ADR 0018 (the page as a build artifact, the list as Discovery), #75 (the
portable package spec), #77 (this record), #84, #85, #86, #87, #88, #89.
