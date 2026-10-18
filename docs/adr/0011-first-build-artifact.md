# The Console brings this repository its first build artifact

This repository has never had a build step, and the crawler still does not:
TypeScript is type-checked with `tsc --noEmit` and run directly by tsx, there is
no `dist/` and no `build` script today, and ADR 0003 removed the emit
configuration because nothing compiled the crawler's source. That was a decision
about the crawler, but it has been read as a decision about the repository once
already: `HISTORY.md` records that the `sxzz/workflows` `unit-test.yml` reusable
was rejected on 2026-09-15 because its test job runs `pnpm run build`
unconditionally while "本仓无 build 脚本" — the repository has no build script.

The Console's page is Vue 3 compiled by Vite and then served statically: a real
page with components and a type-only contract shared with the service, not
hand-written browser scripts. Its bundle is this repository's **first build
artifact**, and the decision is that it is the only one and that it is scoped to
the Console:

- The build is part of the `console` start command, so the owner still runs one
  command and never runs a build by hand; a separate development script may run
  the UI dev server against the API for editing the page.
- The bundler and the components stay development dependencies; the crawler's
  runtime imports do not change.
- The output is git-ignored (`dist/` already is), and the sources that produce
  it are inside the repository's existing gates rather than outside them:
  typechecking covers the components, the formatter and the linter cover them,
  the pre-commit hook covers them, and CI builds the bundle.
- `save-wallpapers` and `check-run` keep the no-build property, unchanged.

## Considered options

- **Keep the whole repository build-free and serve a hand-written page** (no
  bundler, no components): the page would have to hand-roll its DOM and could
  not share the API's type declaration with the service, so the artifact saved
  would be paid for in unchecked page code. Rejected.
- **Build at install time** (a `prepare` or `postinstall` step): every install
  and every CI job would pay for a page most of them never serve, and the
  artifact's freshness would depend on a step nobody associates with the
  Console. The start command is the one place that knows the page has to exist.
  Rejected.
- **Make the Vite dev server the user-facing command**: it would ship a
  development server to the page's only user. The dev script exists for editing
  the page and stays separate. Rejected.
- **Extend the crawler's `tsc` config to emit, giving the whole repository one
  build**: the crawler has no consumer of `dist/` — tsx runs the source — so
  this would create an artifact nothing loads and make the no-build property
  untrue for the pipeline as well. Rejected.
- **Wire the `unit-test.yml` reusable back in now that a build script will
  exist**: its test job runs `pnpm run build` unconditionally, but this
  repository's build is the Console's page, not a prerequisite of the test
  suite; adopting it would make the test job depend on a page. Rejected — the
  2026-09-15 row stays the earlier, crawler-scoped record.

## Consequences

- The repository's checks widen rather than change: the components enter `tsc`,
  the pre-commit patterns and CI, and the bundle build becomes a CI gate, so no
  component is ever committed outside them.
- The first `console` start pays the bundle build; later starts reuse it.
- Two dependency sets now exist and must be kept apart: the crawler's runtime
  imports, and the page's development-time stack (Vue, the bundler, its plugin
  and the type checker).
- `HISTORY.md`'s 2026-09-15 rejected-approach row remains true as written — it
  was true for the crawler at that time — and this ADR is where the current,
  scoped truth lives. Documents that read "this repository has no build step"
  now read "the crawler has no build step"; ADR 0003 is scoped to the crawler's
  source accordingly.
- The build artifact and the thumbnail cache are the two things the Console
  brings that are not source, and both are git-ignored (ADR 0010).

Related: ADR 0003 (the crawler's no-dist typecheck, now scoped to the crawler),
ADR 0008 (the Console as a separate entry point), ADR 0010 (the thumbnail
cache).
