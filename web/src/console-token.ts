/**
 * The token this page was opened with; the service wants it on every request
 * (`src/console/server.ts` › `isAuthorized`), assets included.
 *
 * Read from the page's own URL, never persisted: the Console opens
 * `http://127.0.0.1:<port>/?token=<t>`, the service rewrites the built page's
 * asset URLs to carry the same token, and the page appends it to every `fetch`
 * it makes. One home for it because every component that fetches needs exactly
 * this, and a second copy would be a second place the mechanism could drift.
 */
export function consoleToken(): string {
  return new URLSearchParams(window.location.search).get('token') ?? ''
}
