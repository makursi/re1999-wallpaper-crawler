// The page's design system, in one place: the UnoCSS presets, the semantic
// token set, and the preflight that puts that set on `:root`.
//
// This file lives with the page layer because it *is* page code: it defines the
// only colour, radius, spacing and motion values a component may name, and the
// page's own type program (web/tsconfig.web.json) checks it. The design record
// is docs/adr/0013.
//
// Dark only, by decision: the palette echoes the official gallery's own CSS
// (measured 2026-10-19) and there is no light theme and no theme toggle. The
// tokens are CSS custom properties rather than literals in the theme so that a
// light theme could later be added by overriding `:root` alone — the door the
// spec leaves open, and the only reason the indirection exists.
//
// Nothing here reaches the network at runtime. `presetIcons` reads the local
// `@iconify-json/ph` collection at build time and emits every icon it is asked
// for as an inline data URI in the stylesheet, and the three type roles below
// name families the page self-hosts: the `@font-face` rules and the woff2 files
// come from the `@fontsource-variable` packages, whose CSS `web/src/main.ts`
// imports, and Vite emits the referenced bytes into `web/dist`. No font file is
// committed — `web/dist` is git-ignored and the bytes live in `node_modules`.
// The design record for the type roles is docs/adr/0015.
import { defineConfig, presetIcons, presetWind4 } from 'unocss'

/**
 * The semantic token set, by role. Every value here appears exactly once, and
 * the theme below refers to it through `var()`; a component names a role
 * (`bg-surface`, `text-muted`, `border-border`) and never one of these hex
 * values.
 *
 * The palette is the official gallery's, taken from its own CSS:
 * `#0a0d0e` / `#0c0e0f` near-black with a teal bias, `#131818` surface,
 * `#e9dccd` / `#bba893` / `#8c8d8c` the three text levels, `#b55829` the rust
 * accent with `#db6f39` its hover/active state, and `rgba(0, 0, 0, 0.8)` the
 * fullscreen scrim. Success, warning and danger are not the gallery's — it has
 * no such states — so they are new values chosen to sit in the same muted,
 * printed register.
 *
 * The three font-family stacks are tokens for the same reason the colours are:
 * the ordered list of families is written once, here, and `theme.font` refers to
 * it by role.
 */
const tokens = {
  '--token-color-bg': '#0a0d0e',
  '--token-color-bg-raised': '#0c0e0f',
  '--token-color-surface': '#131818',
  '--token-color-surface-raised': '#191f1f',
  '--token-color-border': '#232a2a',
  '--token-color-text': '#e9dccd',
  '--token-color-text-secondary': '#bba893',
  '--token-color-text-muted': '#8c8d8c',
  '--token-color-accent': '#b55829',
  '--token-color-accent-hover': '#db6f39',
  '--token-color-success': '#7f9e6f',
  '--token-color-warning': '#d8a24a',
  '--token-color-danger': '#cf6f5c',
  '--token-color-scrim': 'rgb(0 0 0 / 80%)',
  // The three type roles, each an ordered stack rather than a family. The order
  // is the decision: `serif` puts the Latin display face first, so Latin glyphs
  // in a Chinese heading take Playfair Display and CJK glyphs fall through to
  // Noto Serif SC, the OFL face the gallery's own Source Han Serif body text
  // resolves to. `sans` names the CJK families explicitly, because `system-ui`
  // carries no CJK glyph on Windows. `mono` is Geist for Latin and for the
  // tabular figures a number needs, and it falls back to the body stack for the
  // CJK glyphs Geist does not have — the role is tabular, not monospaced, and a
  // data cell may still hold a Chinese word.
  '--token-font-serif':
    "'Playfair Display Variable', 'Noto Serif SC Variable', 'Songti SC', 'SimSun', serif",
  '--token-font-sans':
    "system-ui, -apple-system, 'Segoe UI', 'Noto Sans', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'Source Han Sans SC', 'Noto Sans CJK SC', 'Noto Sans SC', sans-serif",
  '--token-font-mono': "'Geist Variable', 'Geist', var(--token-font-sans)",
  // Square is the gallery's own tile, so `none` is a first-class radius.
  '--token-radius-none': '0',
  '--token-radius-sm': '0.25rem',
  '--token-radius-md': '0.5rem',
  '--token-radius-pill': '9999px',
  // The measured page rhythm: a 16px grid gutter and a 7vw page edge. The rest
  // of the scale is UnoCSS's own 0.25rem step (`p-3`, `gap-4`, `mt-8`).
  '--token-space-gutter': '1rem',
  '--token-space-page': '7vw',
  '--token-ease-standard': 'cubic-bezier(0.4, 0, 0.2, 1)',
  '--token-ease-out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
  // Weight, not smoothness: 150–220ms is a hover, 500–700ms is an entrance.
  '--token-duration-hover': '180ms',
  '--token-duration-enter': '600ms',
}

/** The token set as `:root` declarations — the one place a value is written. */
const rootTokens = Object.entries(tokens)
  .map(([name, value]) => `  ${name}: ${value};`)
  .join('\n')

export default defineConfig({
  presets: [
    presetWind4({
      // The reset is half the point of the foundation: the page stops starting
      // from the browser's defaults and starts from the tokens below.
      preflights: { reset: true },
    }),
    presetIcons({
      // Mask mode paints each icon with `currentColor`, so an icon follows the
      // text level it sits in. Either mode inlines at build time; this one is
      // the one that inherits.
      mode: 'mask',
      scale: 1,
      // One family only — Phosphor, whose weights all ship in the local
      // `@iconify-json/ph` collection as `i-ph-<name>-<weight>`. Weight is
      // chosen by size: `-light` for large marks and navigation, the regular
      // weight for dense data. A second family is what the rule forbids.
      extraProperties: { display: 'inline-block', 'vertical-align': 'middle' },
      // A misspelled icon name would otherwise emit nothing at all, silently.
      warn: true,
    }),
  ],
  theme: {
    // `font-serif` is the Chinese headings' and navigation's stack,
    // `font-sans` the page's base and its dense data's, and `font-mono` the
    // numerals'. Each names its token, as every colour does, so the family list
    // is written once — in the token block above — and a component names the
    // role. `font-sans` is also the base face: wind4's reset points
    // `--default-font-family` at it.
    font: {
      serif: 'var(--token-font-serif)',
      sans: 'var(--token-font-sans)',
      mono: 'var(--token-font-mono)',
    },
    colors: {
      base: 'var(--token-color-bg)',
      'base-raised': 'var(--token-color-bg-raised)',
      surface: 'var(--token-color-surface)',
      'surface-raised': 'var(--token-color-surface-raised)',
      border: 'var(--token-color-border)',
      primary: 'var(--token-color-text)',
      secondary: 'var(--token-color-text-secondary)',
      muted: 'var(--token-color-text-muted)',
      accent: { DEFAULT: 'var(--token-color-accent)', hover: 'var(--token-color-accent-hover)' },
      success: 'var(--token-color-success)',
      warning: 'var(--token-color-warning)',
      danger: 'var(--token-color-danger)',
      scrim: 'var(--token-color-scrim)',
    },
    radius: {
      none: 'var(--token-radius-none)',
      sm: 'var(--token-radius-sm)',
      md: 'var(--token-radius-md)',
      pill: 'var(--token-radius-pill)',
    },
    spacing: {
      gutter: 'var(--token-space-gutter)',
      page: 'var(--token-space-page)',
    },
    ease: {
      standard: 'var(--token-ease-standard)',
      'out-expo': 'var(--token-ease-out-expo)',
    },
    duration: {
      hover: 'var(--token-duration-hover)',
      enter: 'var(--token-duration-enter)',
    },
  },
  // The numeral role, in one class. A number needs the family *and* the
  // figures, and half the role is a defect — a count in Geist with proportional
  // digits still jumps column to column — so they are not separately reachable:
  // a data cell writes `numeric` (a run id, a timestamp, a count, a rate, a
  // gallery id) and gets Geist with `tabular-nums`. Geist carries a `tnum`
  // feature (measured in the emitted woff2), so the declaration does something.
  shortcuts: {
    numeric: 'font-mono tabular-nums',
  },
  // `theme.duration` is the scale, but wind4's transition rule accepts only a
  // number or a bracket there — it never looks a theme key up — so the two
  // durations are opened as named utilities here as well. Both declarations
  // mirror wind4's own `duration-*` rule: the custom property is what a
  // `transition-*` utility reads, so setting only the property would lose the
  // race against it.
  rules: [
    [
      /^duration-(hover|enter)$/,
      ([, name]) => ({
        '--un-duration': `var(--token-duration-${name})`,
        'transition-duration': `var(--token-duration-${name})`,
      }),
    ],
  ],
  preflights: [
    {
      getCSS: () => `
:root {
  color-scheme: dark;
${rootTokens}
}

body {
  background-color: var(--token-color-bg);
  color: var(--token-color-text);
}

/*
 * The motion tokens collapse under the user's preference, so a component that
 * spells its duration as one of them honours it without a second class.
 */
@media (prefers-reduced-motion: reduce) {
  :root {
    --token-duration-hover: 1ms;
    --token-duration-enter: 1ms;
  }
}
`,
    },
  ],
})
