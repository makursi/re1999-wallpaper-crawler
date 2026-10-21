// ── The second double-click's handshake (#82) ───────────────────────
//
// The record (`web/server/instance-record.ts`) says where a running Console
// lives; this module asks whether it is still there. The question is one plain
// loopback request to `/api/instance`, carrying the record's own token: the
// route answers only behind the same token guard as the rest of the surface, so
// a 200 means the service that wrote the record is still the one listening — not
// a stranger that happened to take the port after a crash.
//
// Why not `/api/status`: that read is the page's poll and may ask the game's
// site for the Gallery list. A handshake must be cheap and independent of the
// network, because a slow probe would be read as "no service" and start the very
// second Console this ticket exists to prevent.
//
// Every failure — an absent or unreadable record, a refused connection, a 403
// from a service holding another boot's token, a timeout, a body that is not the
// marker — is `null`, and `null` means "start normally". Nothing here throws,
// retries or logs: the caller cannot tell the failures apart because it must not
// care about them.

import { instanceRecordPath, instanceUrlOf, readInstanceRecord } from './instance-record.js'
import { INSTANCE_PROBE_PATH } from './routes/instance.js'

/**
 * How long the probe may take. A local service answers this route in
 * milliseconds; a second is already generous. Long enough not to be read as
 * "gone" while the running Console is busy, short enough that a double-click
 * with a dead record still opens in about the time the service takes to boot.
 */
export const HANDSHAKE_TIMEOUT_MS = 1500

export interface HandshakeDeps {
  /** The network, injected so a test can prove the failure shapes. */
  fetchImpl?: typeof globalThis.fetch
  timeoutMs?: number
}

/**
 * The running Console's page URL when the record points at a service that
 * answers as this program, `null` otherwise.
 */
export async function runningInstanceUrl(
  dataRoot: string,
  deps: HandshakeDeps = {},
): Promise<string | null> {
  const reading = readInstanceRecord(instanceRecordPath(dataRoot))
  if (reading.kind !== 'record') return null
  return (await instanceAnswers(reading.record.port, reading.record.token, deps))
    ? instanceUrlOf(reading.record)
    : null
}

async function instanceAnswers(port: number, token: string, deps: HandshakeDeps): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  try {
    const response = await fetchImpl(
      `http://127.0.0.1:${port}${INSTANCE_PROBE_PATH}?token=${encodeURIComponent(token)}`,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(deps.timeoutMs ?? HANDSHAKE_TIMEOUT_MS),
      },
    )
    if (!response.ok) return false
    const payload: unknown = await response.json()
    return typeof payload === 'object' && payload !== null && 'ok' in payload && payload.ok === true
  } catch {
    return false
  }
}
