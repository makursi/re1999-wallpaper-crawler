# The Console's HTTP surface routes with a library, and keeps its own identity

The Console's service was one file of hand-written transport: method-and-path
routing, the token / `Host` / `Origin` guard, four response shapes, the built
page's markup rewrite, the stylesheet's `url()` rewrite, and the port fallback.
Adding a route meant editing a single long handler chain, and every route
hand-rolled its own method check, its own headers and its own 404/405 wording —
six copies of one rule, each free to drift.

Dispatch and URL parsing are now a library's job: hono 4 behind
`@hono/node-server` 2, running a standard `Request` → `Response` app on Node's
`http` server. Everything the page depends on stays ours, deliberately:

- **The guard.** One middleware above every route, so a new route is
  authenticated by construction rather than by remembering to be. The
  repository's security model is a token on every request — assets included —
  and it is not a framework's to reinterpret.
- **The response headers.** Four hand-built shapes (JSON, image bytes, the page,
  an asset). The tests assert exact strings: `application/json; charset=utf-8`,
  `public, max-age=31536000, immutable`, `nosniff`, `allow`. The router's own
  serialiser emits its own variants — its JSON helper writes no charset at all —
  so a framework default never serves a response an assertion touches.
- **The stylesheet rewrite.** A static-file helper maps a path to bytes and
  streams them; it cannot put this start's token on the `url()` references
  inside a stylesheet, and without that rewrite every webfont request arrives
  unauthenticated (measured: 16 of 16 refused). So the asset route stays
  hand-written.
- **The port fallback.** A busy or forbidden port is answered with an
  OS-assigned one, because a page that refuses to open is the worst available
  failure mode. `EADDRINUSE` and `EACCES` are told apart from a real failure
  exactly as before.

The dependency contract moved to its own module and is re-exported from the
entry the tests already import, so the swap itself touched none of the five test
files that drive the bound service, and they stayed green: the refactor had to
produce the same answers with a different shape. (The contract gained a field in
an earlier ticket of the same iteration, which is why two bodies in one of those
files name it — that change is the contract's, not this swap's.) The route
modules gather inputs and hand them to the module that decides — `status.ts`,
`gallery-view.ts`, `run-control.ts`. No route invents a status for a domain
state, which is what makes "the transport does not judge" auditable by reading
one directory.

## Considered options

- **Express 5.** Its `res.send`/middleware model is built for handlers that
  compose a response imperatively, which is exactly the shape that invites
  domain decisions into the transport, and its defaults differ from the headers
  this surface promises. Rejected.
- **Fastify 5.** Its schema and plugin system is larger than this need: one
  process, one page, six routes, no plugins, no serialisation schemas. Rejected.
- **srvx (1.0).** A one-line server around a standard `fetch` handler, but at
  1.0 with no track record. Not infrastructure this console should bet on.
- **Keep `node:http` and add only a static-file helper.** The helper cannot do
  the one transformation that matters (the stylesheet body), so the hard part
  stays hand-written and nothing is gained but a dependency. Rejected.
- **Replace the token mechanism (a cookie, or an API path prefix) so that a
  stock static-file helper could serve the assets.** That is a security decision
  wearing a refactor's clothes: the token on every request, assets included, is
  what lets the page be the only client. Out of scope, and it would need its own
  ADR.

## Consequences

- Two runtime dependencies in a repository that otherwise ships almost none; both
  are confined to `web/server/http/` and `web/server/server.ts`.
- A framework upgrade must keep the tests that drive the bound service green.
  That is the point of leaving them untouched: they are the contract, not an
  implementation detail.
- The published documentation already describes the router's next major while the
  installed release is the previous one. The installed version is the reference;
  a page read on the website may describe APIs this code does not have.
- The adapter's `hostname` option exists only in its type declarations, not in its
  documentation. It is named once, in `web/server/server.ts`, and is the only
  thing keeping the bind loopback-only besides the explicit `listen` call.
- This does not overturn the earlier rejection of an HTTP framework
  (`HISTORY.md`, 2026-06-15): that one was about the crawler's command line,
  which has no routes, no API and no database. This surface has routes.

Related: ADR 0008 (the Console is the human entry point, and the CLI keeps no
dispatcher), ADR 0010 (thumbnails live outside the Mirror), ADR 0016 (the WebUI
is the only human entry).
