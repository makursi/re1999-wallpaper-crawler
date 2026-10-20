// ── Writing this start's token into what the browser will request ───
//
// The guard requires the token on every request, and a `<script>`, a `<link>`
// and a `url()` inside a stylesheet cannot attach a query string of their own.
// So the service rewrites what it serves: the built page's asset URLs, and every
// relative `url()` the built stylesheet embeds. The page then reads the token
// from its own URL and appends it to every `fetch` it makes.
//
// No cookie, nothing persisted, and no route prefix: the API routes stay exactly
// as the spec lists them.
//
// Two references, one rule (`withToken`), because the markup and the stylesheet
// must agree about what "carry the token" means.

/**
 * Append this start's token to one relative reference.
 *
 * `?` when the reference has no query, `&` when it already has one, and
 * unchanged when it already carries a `token` parameter — so a second pass over
 * the same reference cannot produce `?token=…?token=…` or `?v=2?token=…`.
 *
 * A `#fragment` stays last: `url(./sprite.svg#icon)` has to become
 * `./sprite.svg?token=<t>#icon`, because a browser never sends a fragment to the
 * server and a token placed after the `#` would arrive as nothing at all.
 */
export function withToken(reference: string, token: string): string {
  const hash = reference.indexOf('#')
  const target = hash === -1 ? reference : reference.slice(0, hash)
  const fragment = hash === -1 ? '' : reference.slice(hash)

  const query = target.indexOf('?')
  if (query !== -1) {
    const parameters = new URLSearchParams(target.slice(query + 1))
    if (parameters.has('token')) return reference
  }
  const separator = query === -1 ? '?' : '&'
  return `${target}${separator}token=${encodeURIComponent(token)}${fragment}`
}

/**
 * The `url()` references a stylesheet resolves itself, in either quoting style:
 * `url(./x.woff2)`, `url("./x.woff2")` and `url('./x.woff2')`.
 *
 * Only `./`-relative references are matched. That is exactly what Vite emits
 * with `base: './'`, and it is what leaves the other three forms a stylesheet
 * can hold untouched: an absolute `url(https://…)`, an inline `url(data:…)` and
 * a document fragment `url(#mask)` — none of which a token belongs on.
 */
const CSS_URL_REFERENCE = /url\(\s*(?:(["'])\.\/([^"']*)\1|\.\/([^)"'\s]*))\s*\)/g

/**
 * Serve a stylesheet with the token appended to every relative `url()` it
 * embeds, for the same reason the built page's markup gets one — and one the
 * page's rewrite cannot reach.
 *
 * A browser resolving a relative `url()` inside a stylesheet does **not**
 * inherit the stylesheet's own query string: it resolves against the
 * stylesheet's URL with the query dropped. So `index-<hash>.css?token=<t>`
 * pointing at `url(./font.woff2)` made the browser request
 * `/assets/font.woff2` with no token, and the guard refused all 16 webfonts
 * while `document.fonts` reported 110 declared faces and none loaded. The
 * token has to be written into the reference itself.
 *
 * This covers every asset a stylesheet can embed, not just fonts: a
 * `background-image`, a mask, a cursor — anything `url()` can name.
 */
export function rewriteStylesheet(css: string, token: string): string {
  return css.replace(
    CSS_URL_REFERENCE,
    (match: string, quote: string, quoted: string, bare: string) => {
      const reference = quoted === undefined ? bare : quoted
      const rewritten = withToken(`./${reference}`, token)
      // Keep the reference's original quoting, so the served stylesheet differs
      // from the built one only in the token.
      return quote === undefined ? `url(${rewritten})` : `url(${quote}${rewritten}${quote})`
    },
  )
}

/**
 * The built page's markup, with the token on every asset URL Vite emitted.
 *
 * Vite writes `src="./assets/index-<hash>.js"` (base `./`), and those two
 * attributes are the whole of what a `<script>` and a `<link>` can name. The
 * page itself is reached with the token on its own URL, which is where every
 * `fetch` in it reads the same value from.
 */
export function rewritePageMarkup(html: string, token: string): string {
  return html.replace(
    /(src|href)="\.\/(assets\/[^"]+)"/g,
    (_match, attribute: string, assetPath: string) =>
      `${attribute}="${withToken(`./${assetPath}`, token)}"`,
  )
}
