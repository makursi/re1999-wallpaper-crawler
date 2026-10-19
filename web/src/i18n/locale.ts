// ── Which language the page is in ───────────────────────────────────
//
// The dictionary (`web/src/i18n/messages.ts`) is the data; this is the state
// around it: the locale in force, the switch that changes it, and the two places
// outside the page's own text that have to follow — `<html lang>`, which tells a
// screen reader and a translation tool which language this is, and
// `document.title`, which follows the page into a tab, a bookmark and a
// screenshot.
//
// The choice is remembered in `localStorage`. It is deliberately not a `?lang=`
// query parameter: the page's URL already carries the Console's token
// (`web/src/console-token.ts`), and a language in the URL would be a second
// source of truth a bookmark could pin against the reader's own switch.
//
// A stored value that is not one of the dictionary's locales is ignored rather
// than trusted — it may come from an older build, or from a hand-edited entry —
// and a browser that refuses storage (private mode, disabled cookies) still gets
// a working switch for the session; it just does not remember it.

import { ref, watchEffect } from 'vue'

import {
  DEFAULT_LOCALE,
  isLocale,
  translate,
  type Locale,
  type MessageKey,
  type MessageParams,
} from './messages'

/** The one `localStorage` key the language choice is remembered under. */
const STORAGE_KEY = 'webui.locale'

function storedLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isLocale(stored) ? stored : DEFAULT_LOCALE
  } catch {
    // A browser that refuses storage still gets the default language.
    return DEFAULT_LOCALE
  }
}

/** The locale the page is speaking; `zh-CN` until the reader says otherwise. */
export const locale = ref<Locale>(storedLocale())

/** One message, in the locale currently in force. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(locale.value, key, params)
}

/** Switch the language. Everything that follows the switch does so from here. */
export function setLocale(next: Locale): void {
  locale.value = next
}

/**
 * The two things outside the page's own text that follow the switch. The effect
 * runs once at module load as well, so a stored choice is applied to a document
 * that was served with `zh-CN` in `web/index.html` before anything renders.
 */
watchEffect(() => {
  const current = locale.value
  document.documentElement.lang = current
  document.title = translate(current, 'app.title')
  try {
    window.localStorage.setItem(STORAGE_KEY, current)
  } catch {
    // Not remembering the choice is all a refusing browser loses.
  }
})
