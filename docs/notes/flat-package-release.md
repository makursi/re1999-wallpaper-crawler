# The release is a flat folder installed with npm

## The question

Spec #116's trigger was the shape of the release, not anything the crawler did.
The archive was a self-contained Windows portable package: a zip carrying
`node.exe` (92.5 MB), `sharp` and the four packages its loader loads, two `.bat`
launchers and a manual, with `app\` (the program) and `data\` (the data) as
siblings. Every cost followed from that one choice. The size duplicated a runtime
the machine already had. The launcher existed only to change directory, set two
root variables and exec, and its ASCII-only, logic-free constraint pushed every
decision back into the program. The in-place updater was the repository's only
module to recursively delete a user-visible directory, so it needed an install
pointer outside the folder, a liveness probe, a path whitelist and a
one-generation `app.old\` rollback. The dependency closure in `node_modules` was
picked by hand in the packager.

What should a release be when the machine already has Node and npm, and which
parts of the old shape are actually load-bearing? (#116)

## Settled

- **The install root is the built tree.** The extracted zip is not a wrapper
  around the program; its root **is** the program root: the two bundles, the
  page, the manifest, the lockfile, `.npmrc`, `.env`, the licence and the README.
  There is no `app\`, no `node.exe`, no `.bat`, no manual, no `update.js`, no
  `node_modules\` and no `data\` in the archive. (#117, #118)
- **Installing is `npm install` once; starting is `npm start`.** The build writes
  the shipped manifest — `scripts.start` is a zero-argument `node server.js`,
  `engines.node` is the repository's floor, `dependencies` is `sharp` alone — and
  npm runs the script with the package root as the working directory. That is
  what makes the Console's existing working-directory fallback land on the
  install root, and `dataRootOf()` on its `data\` child. No launcher, no new CLI
  argument, no new root variable; the `RE1999_*` variables stay the only
  override, for the source tree, `pnpm webui` and tests. (#117)
- **The data is one child of the install folder.** `data\` holds `layout.json`,
  `images\`, `logs\`, `cache\` and `user.env`, created by
  `core/data-layout.ts` exactly as before. The program writes nothing outside the
  folder — no pointer, no registry, no service — so uninstalling is deleting one
  folder. (The npm that runs `npm install` keeps its own cache in the user
  profile; that belongs to npm, not to the program.) (#117, #118, ADR 0024)
- **An update is three documented steps.** Extract the new zip into a new folder,
  move the old `data\` into it, delete the old folder once the new one has run.
  Zero in-place overwrite, zero deletes by the program, and the old folder is the
  rollback point: it still has its program and dependencies, so rolling back is
  moving `data\` back and starting it. The data layout is unchanged, so no
  migration code ships. (#121, ADR 0024)
- **The archive's contents are a name whitelist.** A short list of root names
  plus `web/dist/**`, asserted by `scripts/package.ts` before the zip is opened
  and owned by `scripts/package-layout.ts`. A runtime binary, a dependency tree,
  a data directory, a source file, a test, a build script or a hidden development
  configuration has no name it can enter under. (#118)
- **The lockfile is generated, not committed.** A second lockfile in the
  repository would be a second truth about what a release installs and would
  drift from the manifest the build writes. The packager resolves the shipped
  manifest with `npm install --package-lock-only` in a temporary directory,
  checks that the result names that manifest's dependencies, and carries it. That
  is `pnpm package`'s one network step. (#118)
- **The Node floor has one source and two enforcements.** `engines.node` reaches
  the bundles as `RE1999_NODE_FLOOR`, the Console's first check prints one
  Chinese sentence and exits 1 before the handshake or a bound port, and the
  shipped `.npmrc` sets `engine-strict=true` so npm refuses the install first. A
  bypassed install check still cannot produce a page whose every thumbnail fails.
  (#117)
- **The README is the one product document.** It ships at the archive root, covers
  install, both stops, where the data lives, the update's three steps, rolling
  back, uninstalling, the first scrape's size and duration, what to check when
  `npm install` fails, the copyright statement and where to ask; the repository's
  command set stays in `AGENTS.md` behind one pointer. `tests/scripts/readme-docs.test.ts`
  pins the facts a reader acts on, not the prose. (#121)
- **The vocabulary and the record moved with the shape.** ADR 0024 records the
  flat shape and supersedes the contradictory clauses of ADRs 0019, 0020, 0021
  and 0022 by number (and records that ADR 0016's letter was already superseded
  by 0019), leaving their text untouched; `CONTEXT.md` retires the launcher, the
  updater and the install pointer, redefines the fallback point and the program
  directory, and states the replacements in its `_Avoid_` lines;
  `CONTEXT-MAP.md`'s Distribution context drops the deleted modules. (#121)
- **The version is `2.0.0`.** ADR 0021's semver reading gains the clause this
  shape needs: MAJOR also covers a change to how the program is installed and
  updated. The old portable folder cannot be updated in place, and its `data\`
  moves by hand, so the number is not a judgement call. (#121)
- **The checks move up to the new seam.** `pnpm smoke:boot` stages the built
  tree as the install root, starts it through `npm start` with no `RE1999_*`
  variable, and drives the page's own API; `pnpm package:check` takes the real
  zip, extracts it, runs `npm install`, `npm start`, the probe and the exit on a
  temporary root. The second needs a registry, so it is not in every PR. (#117,
  #120)

## Open

- **`npm i -g` / `npx` distribution.** Out of scope for this release: a global
  install writes outside the folder, contradicts "uninstalling is deleting one
  folder", and needs a registry name the project does not own. If it comes back,
  the question is what replaces the "one folder holds all state" property.
- **macOS and Linux artifacts.** The zip, `sharp`'s native half and the update
  documentation are Windows-shaped today, and no macOS/Linux artifact was built.
  Nothing in the flat shape is Windows-specific any more except the platform
  binaries `npm install` resolves, but the release and its smoke test have not
  been exercised elsewhere.
- **A clean-machine install is proven by the release check, not every PR.**
  `pnpm package:check` needs a reachable registry, so a failure in the registry
  leg — proxy, mirror, cache — is first seen when that check or the release
  workflow runs. A hermetic dependency vendoring story was explicitly out of
  scope; an offline install path would be its own spec.
- **The README's screenshot and English version are not in the archive.** The
  name whitelist carries `README.md` only, so both links point at GitHub (the
  language switch, the screenshot and the licence are absolute URLs). Whether
  the archive should also carry `README.en.md` and the screenshots is a whitelist
  change nobody has argued yet; today the document is correct and one click
  online, and dead offline.
- **The hand-move is documentation, not a check.** No test can prove `data\` was
  moved before the old folder was deleted. The three steps are short and the
  old folder is harmless if kept; a tool that did the move would be an updater
  again, which this shape deliberately does not have.

## Rejected

- **Siphon a runtime per release** (download or vendor `node.exe` into the
  archive). Rejected: the machine already has Node — that is the premise of
  installing with npm — so the runtime was 92.5 MB of duplicated download in every
  release, with its own patch schedule. It is also what forced the launcher, the
  two injected roots and the ASCII-only `.bat`, so keeping it would keep all
  three. (#116)
- **Keep a launcher as glue.** Rejected: a `.bat` cannot carry a decision or a
  Chinese line reliably (ADR 0020's four measured encodings), so every decision
  was pushed into the program, and what remained — change directory, set two
  variables, exec — is exactly what npm's package-root working directory already
  guarantees. A second entry point with no decision in it is a seam with no job.
  (#116)
- **An in-place updater with an install pointer and a rollback generation.**
  Rejected: it was the only module that recursively deleted a user-visible
  directory, and to be safe it needed a pointer outside the folder (a file that
  moves with the folder cannot say where the folder went), a liveness handshake,
  a path whitelist, a rollback that can itself fail, and a one-generation
  `app.old\`. The three documented steps reach the same result with zero deletes
  by the program and the old folder as the rollback. (#116, #119)
- **A second lockfile in the repository.** Rejected: it would be a second truth
  about the release's dependency resolution, and it would drift from the manifest
  the build writes — the same class of failure as a hand-picked `node_modules`
  closure. Generating it at package time keeps one source and makes the packager
  check the pair it ships. (#118)
- **Ship `node_modules`.** Rejected: resolution rules, platform binaries and size
  travel with it, and every dependency change becomes a manual whitelist edit —
  the maintenance cost this iteration removes. `sharp` is the one native module
  the program loads, and `npm install` is the one dependency step.
  (#116, #118)
- **Distribute through `npm i -g` or `npx`.** Rejected for this release: a global
  install writes outside the folder, so "uninstall = delete one folder" stops
  being true; it also needs a registry package the project does not publish. The
  zip is the one channel and the spec puts registry distribution out of scope.
  (#116)
- **Keep the in-package manual beside the README.** Rejected: two documents that
  describe the same install drift, and the manual was one of the files the
  launcher's removal took with it. One product document, one repository document
  (`AGENTS.md`). (#119, #121)
