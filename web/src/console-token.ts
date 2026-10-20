/**
 * The token this page was opened with; the service wants it on every request
 * (`web/server/server.ts` › `isAuthorized`), assets included.
 *
 * Read from the page's own URL, never persisted: the Console opens
 * `http://127.0.0.1:<port>/?token=<t>`, the service rewrites the built page's
 * asset URLs to carry the same token, and the page appends it to every `fetch`
 * it makes. One home for it because every component that fetches needs exactly
 * this, and a second copy would be a second place the mechanism could drift.
 */
/**
 * The one DOM this module touches, declared locally.
 *
 * The page's pure modules (`lib/console-api.ts`) import this file, and those are
 * typechecked by the repository's root type program, which deliberately has no
 * DOM library. Declaring the single member the module reads keeps the file
 * honest in both programs — the page's own program has the real `Window`, and
 * this module never reaches for anything else.
 */
declare const window: { location: { search: string } }

export function consoleToken(): string {
  return new URLSearchParams(window.location.search).get('token') ?? ''
}
