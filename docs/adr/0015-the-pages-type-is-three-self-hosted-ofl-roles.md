# The page's type is three self-hosted OFL roles

The page guards a wall of artwork and it rendered all of it in one face:
`system-ui, sans-serif`, hard-coded in a component. The gallery it mirrors sets
its `body` in Source Han Serif with a Didot-flavoured display word and a muted
sans for long copy, and the spec's visual system asks the page to echo that
register — Chinese headings in serif, a Latin display voice, and numbers that
line up in a column. This ADR records the three roles, the faces that fill them,
where the bytes live, and what is refused. It builds on ADR 0013's token set and
re-decides none of it.

- **Chinese headings and navigation are serif, with the Latin display face
  first.** `--token-font-serif` is `'Playfair Display Variable'`, then
  `'Noto Serif SC Variable'`, then Songti SC and SimSun, then the generic
  `serif`. The order is the decision: Playfair Display is a Didone and covers no
  CJK, so the Latin glyphs of a heading — and a Latin label written into a
  Chinese page — take the display face while every CJK glyph falls through to
  Noto Serif SC, the OFL form of the Source Han Serif the gallery's own `body`
  rule resolves to. This is the position the site fills with a `WALLPAPER` type
  *image*; the page fills it with real text and no image at all.
- **Chinese body text and dense data keep the system sans stack, with the CJK
  families named.** `--token-font-sans` lists `system-ui` and the platform sans
  families, then Microsoft YaHei UI, Microsoft YaHei, PingFang SC, Hiragino Sans
  GB, Source Han Sans SC, Noto Sans CJK SC and Noto Sans SC before the generic
  `sans-serif`. Naming them is not redundant: on Windows `system-ui` resolves to
  Segoe UI, which carries no CJK glyph, so an explicit CJK family is the only
  thing between a Chinese paragraph and the browser's last-resort face. The
  stack is also the page's base face — wind4's reset points
  `--default-font-family` at `theme.font.sans`.
- **Numerals and UI Latin are Geist, in tabular figures, exposed as one class.**
  `--token-font-mono` is `'Geist Variable'`, `'Geist'`, then the body stack.
  The family is not monospaced and the role is not "code": it is the face for a
  run id, a timestamp, a count, a `successRate` and a gallery id. Measured from
  the emitted woff2, Geist carries a `tnum` feature beside `pnum`, `zero` and
  `frac`, so `font-variant-numeric: tabular-nums` does real work. The two halves
  are not separately reachable: the `numeric` shortcut expands to
  `font-mono tabular-nums`, because a count in Geist with proportional figures
  still jumps column to column, and half the role is a defect. The fallback is
  the body stack rather than a monospace family, because Geist has no CJK glyph
  at all and a data cell also holds Chinese (dense data takes the same role);
  the CJK in a numeric cell must land in the system CJK face, not in SimSun.
- **The three families were already installed, and only normal faces are
  used.** `@fontsource-variable/noto-serif-sc` 5.3.1 (`Noto Serif SC Variable`,
  weights 200–900), `@fontsource-variable/playfair-display` 5.3.0 (`Playfair
  Display Variable`, 400–900, latin / latin-ext / cyrillic / vietnamese) and
  `@fontsource-variable/geist` 5.3.0 (`Geist Variable`, 100–900, latin /
  latin-ext / cyrillic / cyrillic-ext / vietnamese) are devDependencies the
  design-system ticket added. The page imports each package's `index.css` — the
  entry point that carries its `@font-face` rules — and not `wght-italic.css`,
  so no italic byte is emitted.

## Where the bytes live

- **The build emits them; the repository does not carry them.** `web/src/main.ts`
  imports the three packages' CSS, Vite rewrites each `url()` to an emitted
  asset and copies the referenced woff2 into `web/dist/assets`. Measured on the
  built page (2026-10-19): 100 Noto Serif SC chunks (5.75 MiB), four Playfair
  Display faces (88 KiB) and five Geist faces (75 KiB) — 109 files, 5.9 MiB —
  plus one 2.4 KiB Noto chunk that Vite inlines as a `data:` URI under its 4 KiB
  asset-inline limit. The stylesheet grows from 15.0 kB to 116.9 kB. The diff of
  this change contains tokens, an import list and comments; no font file, and
  `web/dist` is git-ignored, so `git` sees no font byte at all.
- **A CJK face is why the stylesheet is large and why a page load stays small.**
  Fontsource ships Noto Serif SC as 101 `unicode-range` chunks rather than one
  5.75 MiB file, so the browser requests only the chunks covering the glyphs
  actually on the page — the transfer is proportional to the text, the directory
  is not. The four Latin subsets of Playfair and the five of Geist are small
  enough that importing the package's stylesheet whole is the honest way to take
  its `@font-face` rules.
- **Nothing is fetched at runtime.** No CDN, no `unocss` web-fonts preset, no
  Google Fonts link, no runtime request of any kind: the built stylesheet's only
  absolute URL is the SVG namespace inside an inlined icon, and every font
  `url()` is a relative asset beside the stylesheet.
- **`theme.font` names the three roles, and each role names its token**, the way
  every colour already does, so the ordered family list is written once — in the
  token block — and a component names `font-serif`, `font-sans` or `numeric`.
  The page applies them where it has a place today: the one `h1` and the two
  `h2`s are `font-serif`, the body and its dense data are `font-sans` (the
  reset's base face), and each run id, log name, count, rate and gallery id is
  `numeric`. The navigation pill and the display mark arrive with the visual
  rework, and the Chinese copy with the bilingual ticket; neither changes a role.

## Considered options

- **MiSans** (Xiaomi's system face, the closest thing to a free Chinese UI sans):
  **rejected on licence.** Xiaomi's own EULA forbids redistribution, which is
  exactly what committing a font to a repository and serving it from `dist`
  would be. A face we may not pass on cannot be a role.
- **HarmonyOS Sans, Alibaba PuHuiTi**: **rejected on verifiability.** Both are
  used in the wild as "free" Chinese families, but neither licence could be
  confirmed from a primary source — the terms are published on pages that move
  and, in the PuHuiTi case, differ between the free and commercial offerings. A
  licence we cannot quote is not a licence we can rely on.
- **PP Editorial New, Clash Display**: **rejected as commercial.** Both are
  sold per project, and a repository that redistributes the file cannot claim
  the licence; the Didone position is filled by an OFL face instead.
- **The site's own `Serif.ttf`, `Sans.ttf` and `Didot.ttf`**: **rejected as
  site assets.** The files are downloadable from the gallery's own CDN, but they
  are its assets and not ours to redistribute — and the serif one is Source Han
  Serif, so the OFL copy is the same design with a licence that permits this
  use. The Didone voice is reproduced with Playfair Display rather than the
  site's Didot. No game asset enters the repository, which is also why the
  atmosphere around the type is CSS.
- **A CDN font (Google Fonts, a Chinese mirror)**: rejected. The page must
  behave identically offline and on loopback, the request would leak the page's
  own token-bearing URL context to a third party, and the fonts are already on
  disk as devDependencies.
- **`@unocss/preset-web-fonts`**: rejected for the same reason — it emits a
  runtime link for families we can inline instead.
- **Subsetting the CJK face down to the page's own glyphs** (a build-time
  subsetter such as `glyphhanger` or a `fonttools` step): considered and
  rejected for now. It would put a `postinstall`-capable toolchain into the
  build for a page whose text is still being rewritten, and it would need a
  place in `pnpm-workspace.yaml`'s `allowBuilds`; fontsource's own
  `unicode-range` chunking already makes the *transfer* proportional to the
  glyphs used, which is the property that matters. This ticket adds no
  dependency and no build script, so `allowBuilds` is unchanged.
- **Keeping one `system-ui` stack for everything**: rejected — that is the state
  this change exists to end, and it is why a heading and a count were
  indistinguishable from a paragraph.

## Consequences

- Type is now a token, like colour: a family change is a change to
  `--token-font-*`, and every heading, body cell and number follows without a
  component being edited. A number cannot accidentally take half the numeral
  role, because only the `numeric` shortcut exposes it.
- The role split is deliberately incomplete in one direction: `code` elements —
  file names, Run-log names, the raw defect JSON — take Geist through wind4's
  reset (`--default-monoFont-family` points at `theme.font.mono`) without naming
  a class. That is intended: those are UI Latin strings, and the reset is the
  only place that decides them.
- The page's built page is far heavier than it was: about 117 kB of stylesheet
  and 5.9 MiB of woff2 in `web/dist`. None of it is in the repository, all of it
  is local, and a viewer who reads one screen transfers only the chunks that
  screen's glyphs fall into.
- The roles are not unit-tested. There is no seam in a font stack: the evidence
  is the built stylesheet — the three token declarations, the `numeric` rule,
  the emitted assets and their sizes — plus the screenshot pairs the visual
  tickets carry.

Related: ADR 0013 (the design system is UnoCSS tokens), ADR 0011 (the page is
this repository's first build artifact), ADR 0012 (the human entry point is
`webui`).
