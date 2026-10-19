# The page's design system is UnoCSS tokens, not a component library

The page is the one thing in this repository a human looks at, and it had no
design system at all: five components each carried a `<style scoped>` block,
fonts were `system-ui, sans-serif`, and every colour was a literal chosen in
place. It reads like a default HTML page, and what it guards is a wall of
artwork. The interface work is split by spec #43 into a foundation (this ADR),
a bilingual interface, a visual and information-architecture rework, and the
font files; this ADR is the foundation's record, and the three later ones build
on it without re-deciding any of it.

- **UnoCSS, `presetWind4`, reset on.** `unocss` 66.11.0 with the wind4 preset
  powers the atomic classes and owns the reset (`preflights.reset: true`), so
  the page stops inheriting the browser's defaults and starts from the tokens
  below. The config is `web/uno.config.ts` — with the page layer, not at the
  repository root — and the page's own type program (`web/tsconfig.web.json`)
  covers it. The page entry imports `virtual:uno.css`.
- **The tokens are semantic and dark only.** Background, surface, border, three
  text levels, one accent with its hover state, success, warning, danger,
  radius, spacing and two motion curves. A component names a role
  (`bg-surface`, `text-muted`, `border-border`) and no hex value appears outside
  the token block. There is no light theme and no theme toggle; the values are
  CSS custom properties anyway, which is the door a later light theme would open
  and the only reason the indirection exists.
- **The palette is the gallery's own, measured, not copied.** From the site's
  CSS on 2026-10-19: near-black with a teal bias `#0a0d0e` / `#0c0e0f`, surface
  `#131818`, text `#e9dccd` / `#bba893` / `#8c8d8c`, accent `#b55829` with
  `#db6f39` on hover, scrim `rgba(0, 0, 0, 0.8)`. Success, warning and danger do
  not exist on the site, so they are new values in the same muted register. No
  site asset, font file or image enters the repository; the atmosphere is
  recreated in CSS.
- **`reka-ui` supplies behaviour, never looks.** 2.11.0, as a headless
  primitive. The first thing it replaces is the fullscreen viewer's hand-rolled
  Escape listener: the viewer becomes `DialogRoot` / `DialogOverlay` /
  `DialogContent`, and Escape, the focus trap, the outside-click dismissal,
  `role="dialog"` with `aria-modal`, and the focus return to the tile that
  opened it are the primitive's. Restyling that viewer is a later ticket; this
  one only moves the behaviour.
- **Icons are Phosphor, inlined at build time.** `presetIcons` reads the local
  `@iconify-json/ph` 1.2.2 collection and emits each icon as a `data:` URI in
  the stylesheet — the built page has no runtime icon request and no CDN. One
  family only, and the weight follows the size: `-light` for the page's large
  mark and navigation, the regular weight for dense data and controls. A
  dynamic icon name would defeat the inlining, so names are written out and are
  never assembled from strings.
- **Two rules travel with the stack.** `backdrop-blur` is allowed on fixed and
  sticky overlays only, never on scrolling content — and the built stylesheet
  contains none, because nothing needs one yet. There is no custom cursor: the
  gallery's four-layer cursor is delightful on a marketing page and worthless on
  a tool.

## Considered options

- **Onu UI** (the "UnoCSS component library" a UnoCSS stack is likely to reach
  for): **rejected on measurement.** Its npm package is frozen at 1.1.5,
  published 2024-11-10, and the preset it publishes pins
  `@unocss/preset-mini ^0.64`; the page runs `unocss` 66, so installing it would
  put a second, older UnoCSS core in the tree and hand the components' styles to
  a preset that does not share our config. The wind4 rewrite exists only on an
  unpublished branch, so the version that would fit does not exist on npm; the
  documentation domains the README points at do not resolve DNS; and it has no
  i18n layer, while this page's next iteration is bilingual. A dependency whose
  fit, availability and documentation all fail at once is not a close call.
- **Any prebuilt component library**: rejected. The page's whole job is to look
  like the artwork it shows, and the components it needs are a panel, a grid, a
  dialog and a button. A library would arrive with its own design decisions
  (radii, shadows, motion) and its own upgrade treadmill, and we would spend the
  next iteration overriding it; behaviour is what is actually hard, and
  `reka-ui` sells exactly that.
- **A light theme, or following the system's preference**: rejected. This page
  is a night-time look at a gallery; a second palette would double the contrast
  and token surface to serve a case the owner does not have. Nothing in the
  components assumes dark except the palette, so the decision is reversible
  later by value, not by rewrite.
- **`@iconify/vue` with its runtime fetch**: rejected. It would make the page
  depend on a third-party icon API at runtime, against the offline requirement,
  for icons we already have on disk and can inline.
- **Keeping the per-component `<style scoped>` blocks**: rejected. They are the
  reason the page has no shared vocabulary today; a token only exists if there
  is one place the value can be named, and scoped blocks re-create the literal
  everywhere.
- **Contributing an Onu UI wind4 build**, or vendoring the parts we want:
  considered and rejected as out of scope. Both would make this repository a
  maintainer of someone else's component library to save a few dozen lines of
  markup we have to write anyway.

## The visual language we took, and the dogmas we refused

The gallery's own CSS is the reference for how the page should feel: hairline
borders as an alpha over the surface rather than a grey line, no shadows at all,
square tiles with a 1px border reserved up front so a hover changes colour
without moving anything, a custom `cubic-bezier(0.16, 1, 0.3, 1)`, and display
type doing the work decoration would otherwise do. That is the language this
foundation encodes.

What is refused is the landing-page grammar that ships with it in most design
systems: macro whitespace (`py-24` under every section), a full-page scroll
reveal that animates the gallery the user is trying to look at, and the
double-bezel card (a border inside a border inside a shadow) applied to every
element. Those are gestures for a page whose job is to be scrolled through
once; this page's job is to show images, and the images are already the
composition. Motion keeps its weight — 500–700ms entrances on custom curves,
150–220ms hovers — but it is spent on things that arrive, not on things that
were already there.

## The wall's own decisions (#48), recorded as the foundation's extension

The visual rework built three things this ADR did not anticipate, and each is a
value or a seam whose home is worth naming. None of them re-decides a token.

- **The atmosphere is part of the token preflight, not of a component.** The
  near-black teal base, an amber radial glow bleeding in from the right and a
  desaturated fractal-noise grain at `opacity: 0.03` are two fixed,
  `pointer-events: none` pseudo-elements of the body, painted below the content
  by a negative `z-index`. Both of their values — the glow's colour, the grain's
  `data:` URI, the navigation's 100px fade — are tokens, because the same rule
  applies to them as to a hairline: a value lives in one place. No gallery asset
  is involved; the grain is an SVG `feTurbulence` encoded in the token, so the
  page makes no request for any of it.
- **The wall is five columns, and its distribution is a decision, not a style.**
  `web/src/masonry.ts` is a pure function: the rows in gallery order, each tile
  into the shortest column at the time it is placed, measured in its own height
  for the column's width. It is the one part of the rework that is unit-tested,
  because a wrong distribution is invisible in a screenshot. The heights come
  from the Mirror's own files: `GET /api/gallery` carries a `sizes` map,
  measured by the service (`web/server/image-sizes.ts`, read through the image
  library's only import site) and memoised per file for the process's life. That
  is a new read-only seam, and the reason is measurable rather than aesthetic: a
  tile that learns its height in the browser can only learn it *after* the lazy
  thumbnail loads, and every image that loaded would then re-balance columns
  above and below the reader's cursor — a scrolling wall that never stops moving.
  The cost is one 1.2–2.0s first `/api/gallery` over a 1013-file Mirror and
  ~27ms warm; the alternative was a wall that guesses, and this Mirror is half
  portrait and half landscape, so the guess would have been wrong half the time.
- **The tile's border is reserved, and the dialog's trigger is the tile.**
  `border border-transparent` is on every tile from the first paint, so the rust
  hairline on hover is a colour change and not a layout change (measured: the
  tile's box is identical before and after). The viewer's `DialogRoot` moved up
  to the wall so each tile can be its `DialogTrigger`; that is what gives
  reka-ui a trigger to return focus to, which is the defect the foundation's
  move to the primitive left behind. `aria-modal` is the other: the primitive
  sets `role="dialog"` and hides the document but never states modality, so the
  attribute is written on `DialogContent`.
- **Motion is two keyframe pairs, not animations scattered in components.** The
  site's own entrance — two rem up, fading in — and its sideways equivalent for
  the drawer live in `theme.animation` with the token durations and curves, and
  each has an `out` half because reka-ui keeps a closing layer mounted on the
  strength of its computed `animation-name`. Under `prefers-reduced-motion` the
  two duration tokens collapse to 1ms, so both directions of every layer
  collapse with them; no component spells a duration of its own.
- **One trap this rework re-learned.** A utility named in a comment is still a
  utility the extractor emits: an earlier note saying the page never uses
  `backdrop-blur` shipped a `.backdrop-blur` rule, and a token comment listing
  `p-3`, `gap-4`, `mt-8` shipped those three. The comments now describe the
  thing instead of spelling it, and the built stylesheet carries exactly one
  filter — the navigation pill's.

## Consequences

- The page's look now comes from one file. A colour, radius, duration or easing
  change is a token change, and the components follow without being edited.
- The reset removes the browser defaults the old page was silently built on
  (heading weight, margins, list markers, button chrome). Layout parity with the
  pre-foundation page is therefore not exact, and is not meant to be: the visual
  and information-architecture rework owns the layout.
- Phosphor's icons and the token set are both in the built stylesheet, so the
  page stays fully offline — no CDN font, no runtime icon API, no external
  request.
- New dependencies are the page's only, and all three are devDependencies: the
  crawler's runtime imports do not change (ADR 0011).
- The design system is deliberately not unit-tested. There is no seam in a
  palette or a class list; the evidence is the built bundle, the screenshot
  pairs the visual tickets carry, and the CI build.

Related: ADR 0011 (the page is this repository's first build artifact), ADR 0012
(the human entry point is `webui`), ADR 0010 (thumbnails live outside the
Mirror).
