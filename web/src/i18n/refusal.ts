// ── A refusal, in the reader's language ─────────────────────────────
//
// The service emits a refusal as `{ code, missing }` and never as a sentence
// (#47, docs/adr/0014): the page is the process that knows which language the
// reader chose. This is the page's one place that turns a code into words —
// the refusal's copy and, for `missing-prerequisite`, the prerequisite names
// both come from the dictionary, so switching the language re-words a refusal
// that is already on screen.

import type { ConsoleRefusal } from '../../api-types.js'
import { t } from './locale'
import { PREREQUISITE_MESSAGE_KEYS, REFUSAL_MESSAGE_KEYS } from './messages'

/** One refusal, said in the locale currently in force. */
export function describeRefusal(refusal: ConsoleRefusal): string {
  const key = REFUSAL_MESSAGE_KEYS[refusal.code]
  if (refusal.code !== 'missing-prerequisite') return t(key)
  const missing = refusal.missing
    .map(code => t(PREREQUISITE_MESSAGE_KEYS[code]))
    .join(t('run.causeSeparator'))
  return t(key, { missing })
}
