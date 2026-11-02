// ── The port a browser will open (#131) ─────────────────────────────
//
// The Console's fallback used to accept whatever port the OS handed back. That
// is not a port any client can use: the fetch standard blocks a fixed set of
// them, and every browser — and Node's own `fetch`, which is what the socket
// tests drive the service with — refuses to connect to one with `bad port`. On
// a machine whose dynamic range overlaps that set, a start could print an
// address that looks legitimate and opens nothing.
//
// So the decision is one predicate: a whole number in `1..65535` that the fetch
// standard does not block. `web/server/server.ts` asks it before binding the
// preferred port and again for every OS-assigned answer, and the one sentence
// below is what a start that runs out of usable answers says — the same register
// as `core/node-floor.ts`'s floor refusal, which is the family it belongs to.

/**
 * The fetch standard's blocked ports, from its "port blocking" table:
 * https://fetch.spec.whatwg.org/#port-blocking (the "bad port" list).
 *
 * It is one named thing here rather than an array at the call site because it is
 * the standard's list, not this program's taste: a browser refuses to open the
 * page on any of these, and `fetch` refuses to connect at all.
 */
export const FETCH_BLOCKED_PORTS: ReadonlySet<number> = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
])

/**
 * Whether a client will connect to `port`: a whole number in `1..65535` that the
 * fetch standard does not block.
 *
 * `0` is refused because it is not a port a page can name — it is the OS's
 * "assign me one" request, which the fallback makes and then checks the answer.
 */
export function isUsablePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535 && !FETCH_BLOCKED_PORTS.has(port)
}

/**
 * The refusal when no usable port is left, in the register of the Node floor's
 * sentence: what happened, the preferred port it happened to, and the way out.
 *
 * Pure, so the wording is unit-tested rather than only observed on a machine
 * that happened to run out of ports.
 */
export function portUnavailableRefusal(preferredPort: number): string {
  return `找不到可用端口:首选端口 ${preferredPort} 不可用,请用 --port 指定 1 到 65535 之间、浏览器不会拒绝的端口,然后重新启动。`
}
