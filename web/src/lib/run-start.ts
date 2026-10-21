// ── The start control's word (#83) ─────────────────────────────────
//
// The wall's band and the Run panel offer the same control, and it says one of
// three things: the first fetch, a resume, or another try after a Run that
// reported a problem. The choice is a rule shared by two components, so it is a
// pure function here — the dictionary key, which the component translates.
//
// "First fetch" wins over "another try": on an empty wall the reader has not
// seen a Run end yet, and calling that a retry would be a false history.

import type { MessageKey } from '../i18n/messages.js'

export function startLabelKey(mirrorCount: number, lastRunFailed: boolean): MessageKey {
  if (mirrorCount === 0) return 'wall.start'
  return lastRunFailed ? 'wall.retryStart' : 'wall.continue'
}
