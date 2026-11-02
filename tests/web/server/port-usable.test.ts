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
// the sentence a start that runs out of attempts says.

import { describe, expect, it } from 'vitest'

import { isUsablePort, portUnavailableRefusal } from '../../../web/server/port-usable.js'

describe('isUsablePort', () => {
  it('accepts the Console’s ordinary ports', () => {
    expect(isUsablePort(8791)).toBe(true)
    expect(isUsablePort(65535)).toBe(true)
  })

  it.each([0, -1, 65536, 8791.5])('refuses %s: not a whole port in 1..65535', port => {
    expect(isUsablePort(port)).toBe(false)
  })

  it.each([17, 6000, 6667, 10080])('refuses %i: the fetch standard blocks it', port => {
    // A browser (and Node's `fetch`) refuses to connect to these, so serving one
    // is the same as serving nothing.
    expect(isUsablePort(port)).toBe(false)
  })
})

describe('portUnavailableRefusal', () => {
  it('is one Chinese sentence naming the preferred port and what to do', () => {
    const refusal = portUnavailableRefusal(8791)

    expect(refusal).toContain('8791')
    expect(refusal).toMatch(/[\u4e00-\u9fff]/u)
    expect(refusal).toContain('--port')
    // The same register as the Node floor's refusal: one line, no banner, no
    // exclamation, and a full stop rather than a second paragraph.
    expect(refusal).not.toContain('\n')
    expect(refusal).not.toMatch(/[!！]/u)
    expect(refusal.trim().endsWith('。')).toBe(true)
  })
})
