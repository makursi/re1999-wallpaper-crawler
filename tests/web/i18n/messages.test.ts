// ── The page's dictionary, as data ──────────────────────────────────
//
// The interface's one new seam (spec #43, ticket #46): a pure dictionary plus a
// lookup, with no DOM, no Vue and no service in the way. A type already stops a
// missing key from reaching `t()`; what it cannot finish is the data itself, so
// that is what these pin — the two locales are the same message set, every
// message is written out in full rather than left as a shell, and every message
// interpolates the same parameter names in both languages. A half-translated
// page is the failure this file exists to make loud.

import { describe, expect, it } from 'vitest'

import type { Locale, MessageKey } from '../../../web/src/i18n/messages.js'
import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  messagesFor,
  translate,
  translateParts,
} from '../../../web/src/i18n/messages.js'

/** Every message key a locale carries, sorted, so two locales can be compared. */
function keysOf(locale: Locale): string[] {
  return Object.keys(messagesFor(locale)).toSorted()
}

const PLACEHOLDER = /\{(\w+)\}/g

/** The `{name}` parameters a message names, sorted. */
function placeholders(message: string): string[] {
  return [...message.matchAll(PLACEHOLDER)].map(match => match[1]).toSorted()
}

/** Every key's parameter names, for one locale. */
function placeholdersByName(locale: Locale): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(messagesFor(locale)).map(([key, message]) => [key, placeholders(message)]),
  )
}

describe('the locale dictionary', () => {
  it('speaks zh-CN and en, and opens in Chinese', () => {
    expect([...LOCALES]).toEqual(['zh-CN', 'en'])
    expect(DEFAULT_LOCALE).toBe('zh-CN')
  })

  it('recognises only the locales it carries', () => {
    expect(isLocale('zh-CN')).toBe(true)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('de')).toBe(false)
    expect(isLocale('')).toBe(false)
    expect(isLocale(null)).toBe(false)
  })

  it('carries the same keys in both locales — none missing, none extra', () => {
    expect(keysOf('en')).toEqual(keysOf('zh-CN'))
  })

  it('leaves no message empty in either locale', () => {
    for (const locale of LOCALES) {
      for (const message of Object.values(messagesFor(locale))) {
        expect(message.trim()).not.toBe('')
      }
    }
  })

  it('names the same parameter placeholders in both locales, key for key', () => {
    expect(placeholdersByName('en')).toEqual(placeholdersByName('zh-CN'))
  })

  it('interpolates the parameters a message names, in either language', () => {
    // Typed as a `MessageKey`, which is what a component's `t()` call passes: a
    // key the dictionary does not carry is a compile error, not a blank line.
    const key: MessageKey = 'app.wallpapersInMirror'
    expect(translate('zh-CN', key, { count: 12 })).toBe('镜像中有 12 张壁纸')
    expect(translate('en', key, { count: 12 })).toBe('12 Wallpapers in the Mirror')
  })

  it('returns the message unchanged when it names no parameters', () => {
    expect(translate('zh-CN', 'app.readingMirror')).toBe('正在读取镜像……')
    expect(translate('en', 'app.readingMirror')).toBe('Reading the Mirror…')
  })

  it('leaves a placeholder with no parameter in the text rather than dropping it', () => {
    expect(translate('en', 'run.line', { runId: '2026-10-18T01-03-31' })).toBe(
      'Run 2026-10-18T01-03-31 — verdict: {verdict}',
    )
  })

  it('splits a message at its parameters, so a value can be a data cell', () => {
    // The pieces are what `Message.vue` renders: the parameter's value marked by
    // name, the sentence's own text around it unmarked.
    expect(translateParts('zh-CN', 'app.wallpapersInMirror', { count: 12 })).toEqual([
      { text: '镜像中有 ', name: null },
      { text: '12', name: 'count' },
      { text: ' 张壁纸', name: null },
    ])
  })

  it('marks every parameter in a message, and only the parameters', () => {
    expect(translateParts('en', 'run.line', { runId: 'r-1', verdict: 'clean' })).toEqual([
      { text: 'Run ', name: null },
      { text: 'r-1', name: 'runId' },
      { text: ' — verdict: ', name: null },
      { text: 'clean', name: 'verdict' },
    ])
  })
})
