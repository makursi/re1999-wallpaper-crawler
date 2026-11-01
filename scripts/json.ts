// ── The one JSON-object check the scripts share ─────────────────────
//
// Four scripts read JSON that arrived as text — a lockfile, the shipped manifest,
// a status payload, an archive's `package.json` — and each one has to ask the
// same question before it touches a field. Asking it here is what keeps the
// answer from drifting into four slightly different copies: `null` is not an
// object, an array never is, and a function is not one either.

/** Whether an unknown value is a JSON object, the shape every reader guards with. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
