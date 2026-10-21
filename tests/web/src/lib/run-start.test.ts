// ── The start control's word (#83) ─────────────────────────────────
//
// Two places render the same control — the wall's band and the Run panel — and
// it says one of three things: the first fetch, a resume, or another try after
// a Run that reported a problem. "First fetch" wins over "another try": on an
// empty wall the reader has not seen a Run end yet, and calling that a retry
// would be a false history.

import { describe, expect, it } from 'vitest'

import { startLabelKey } from '../../../../web/src/lib/run-start.js'

describe('the start control’s word', () => {
  it('offers the first fetch on an empty wall, whatever the last Run said', () => {
    expect(startLabelKey(0, false)).toBe('wall.start')
    expect(startLabelKey(0, true)).toBe('wall.start')
  })

  it('offers another try after a Run that reported a problem', () => {
    expect(startLabelKey(300, true)).toBe('wall.retryStart')
  })

  it('offers a resume after a Run that went cleanly', () => {
    expect(startLabelKey(300, false)).toBe('wall.continue')
  })
})
