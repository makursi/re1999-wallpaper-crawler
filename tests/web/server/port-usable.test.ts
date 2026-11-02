// ── A port a browser will open (#131) ───────────────────────────────
//
// The fallback used to accept whatever port the OS handed back. On a machine
// whose dynamic range overlaps the fetch standard's blocked ports that could be
// `6000`: Node's `fetch` then fails with `bad port`, which is what the socket
// tests were intermittently seeing, and a real start prints an address no
// browser will open.
//
// So usability is one decision: a whole number in `1..65535` that the fetch
// standard does not block. `web/server/server.ts` asks it before binding the
// preferred port and again for every OS-assigned answer; the refusal below is
// the sentence a start that runs out of attempts says, and the error carries it
// because the transport has no value to return.

import { describe, expect, it } from 'vitest'

import {
  FETCH_BLOCKED_PORTS,
  PortUnavailableError,
  isUsablePort,
  portUnavailableRefusal,
} from '../../../web/server/port-usable.js'

describe('isUsablePort', () => {
  it('accepts the Console’s ordinary ports', () => {
    expect(isUsablePort(8791)).toBe(true)
    expect(isUsablePort(65535)).toBe(true)
  })

  it.each([0, -1, 65536, 8791.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s: not a whole port in 1..65535',
    port => {
      expect(isUsablePort(port)).toBe(false)
    },
  )

  it.each([17, 6000, 6667, 10080])('refuses %i: the fetch standard blocks it', port => {
    // A browser (and Node's `fetch`) refuses to connect to these, so serving one
    // is the same as serving nothing.
    expect(isUsablePort(port)).toBe(false)
  })
})

describe('FETCH_BLOCKED_PORTS', () => {
  it('holds the fetch standard’s 83 blocked ports', () => {
    // A tripwire against a silently deleted entry: making one of these "usable"
    // has to be a deliberate change that also moves this number.
    expect(FETCH_BLOCKED_PORTS.size).toBe(83)
  })

  it.each([6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080])(
    'blocks %i, a port this machine’s dynamic range can hand out',
    port => {
      expect(FETCH_BLOCKED_PORTS.has(port)).toBe(true)
    },
  )
})

describe('portUnavailableRefusal', () => {
  it('is one Chinese sentence naming the preferred port and what to do', () => {
    const refusal = portUnavailableRefusal(8791)

    expect(refusal).toContain('8791')
    expect(refusal).toMatch(/[\u4e00-\u9fff]/u)
    expect(refusal).toContain('--port')
    // Printed alone on stderr, so one line: no banner and no second paragraph.
    expect(refusal).not.toContain('\n')
  })
})

describe('PortUnavailableError', () => {
  it('carries the refusal sentence whole', () => {
    expect(new PortUnavailableError(8791).message).toBe(portUnavailableRefusal(8791))
  })

  it('keeps the last bind error as its cause', () => {
    const cause = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })

    expect(new PortUnavailableError(8791, cause).cause).toBe(cause)
  })
})
