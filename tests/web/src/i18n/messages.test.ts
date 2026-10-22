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

import {
  CONSOLE_VERDICTS,
  EXPLAINED_REASON_KINDS,
  PREREQUISITE_CODES,
  REFUSAL_CODES,
} from '../../../../web/api-types.js'
import type { Locale, MessageKey } from '../../../../web/src/i18n/messages.js'
import {
  DEFAULT_LOCALE,
  EXPLAINED_REASON_MESSAGE_KEYS,
  LOCALES,
  PREREQUISITE_MESSAGE_KEYS,
  REFUSAL_MESSAGE_KEYS,
  VERDICT_MESSAGE_KEYS,
  isLocale,
  messagesFor,
  translate,
  translateParts,
} from '../../../../web/src/i18n/messages.js'

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
    const key: MessageKey = 'nav.mirrorCount'
    expect(translate('zh-CN', key, { count: 12 })).toBe('镜像 12')
    expect(translate('en', key, { count: 12 })).toBe('Mirror 12')
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
    expect(translateParts('zh-CN', 'nav.mirrorCount', { count: 12 })).toEqual([
      { text: '镜像 ', name: null },
      { text: '12', name: 'count' },
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

/**
 * The setup notice (#93, ticket #95): it shows only while the configuration is
 * really unusable, and then it is two lines — one sentence saying why a Run
 * cannot start, and the line to write. The file is the `.env` beside the
 * program, because a Portable package has no repository root to send a player
 * looking for, and nothing says "refresh the page" any more: the page re-reads
 * the status itself when the drawer opens or the window regains focus. The
 * retired lines of the old four-line notice are gone from both locales.
 */
describe('the setup notice', () => {
  /** The notice's keys in one locale, sorted; `run.setup.*` is the notice whole. */
  function setupKeysOf(locale: Locale): string[] {
    return keysOf(locale).filter(key => key.startsWith('run.setup.'))
  }

  it('is exactly two lines in both locales — the sentence and the line to write', () => {
    for (const locale of LOCALES) {
      expect(setupKeysOf(locale), `${locale}: setup keys`).toEqual([
        'run.setup.body',
        'run.setup.lines',
      ])
    }
  })

  it('gives the .env line verbatim in both locales', () => {
    const lines = 'BASE_ORIGIN=https://re.bluepoch.com'
    for (const locale of LOCALES) {
      expect(translate(locale, 'run.setup.lines')).toBe(lines)
    }
  })

  it('names the .env beside the program, never a repository root', () => {
    for (const locale of LOCALES) {
      const copy = translate(locale, 'run.setup.body', { file: '.env' })
      expect(copy, `${locale}: ${copy}`).toContain('.env')
      // A Portable package is unzipped anywhere and has no repository root; the
      // file the program reads is the one beside the program itself.
      expect(copy, `${locale}: ${copy}`).not.toMatch(/repository root|repo root|仓库根目录|仓库根/i)
      expect(copy, `${locale}: ${copy}`).toMatch(
        locale === 'zh-CN' ? /程序旁边/ : /beside the program/i,
      )
    }
  })

  it('says why a Run cannot start', () => {
    for (const locale of LOCALES) {
      const copy = translate(locale, 'run.setup.body', { file: '.env' })
      expect(copy, `${locale}: ${copy}`).toMatch(
        locale === 'zh-CN' ? /不能开始运行|还不能运行/ : /cannot start|can’t start|can't start/i,
      )
    }
  })

  it('no longer tells the reader to refresh the page', () => {
    for (const locale of LOCALES) {
      const body = translate(locale, 'run.setup.body', { file: '.env' })
      const lines = translate(locale, 'run.setup.lines')
      expect(body, `${locale}: ${body}`).not.toMatch(/refresh|刷新/i)
      expect(lines, `${locale}: ${lines}`).not.toMatch(/refresh|刷新/i)
    }
  })

  it('does not contradict the env-file refusal a start click returns', () => {
    // The notice is guidance and the click's refusal is the error, but both send
    // the reader after the same file; a refusal that named a different place
    // would make the notice a lie the moment the reader clicked start.
    for (const locale of LOCALES) {
      const notice = translate(locale, 'run.setup.body', { file: '.env' })
      const refusal = translate(locale, PREREQUISITE_MESSAGE_KEYS['env-file'])
      expect(notice, `${locale}: ${notice}`).toContain('.env')
      expect(refusal, `${locale}: ${refusal}`).toContain('.env')
      expect(refusal, `${locale}: ${refusal}`).not.toMatch(
        /repository root|repo root|仓库根目录|仓库根/i,
      )
    }
  })
})

/**
 * The update notice (#81): one line and one link, in both languages. The
 * service sends a version and a Releases URL and no sentence, so the two pieces
 * of copy below are all the reader sees; the parity tests above already make a
 * locale that forgot one of them a failure.
 */
describe('the update notice', () => {
  it('names the newer version in both locales', () => {
    for (const locale of LOCALES) {
      expect(translate(locale, 'update.available', { version: '1.2.3' })).toContain('1.2.3')
    }
  })

  it('offers the Releases page, not a download', () => {
    // The copy names where to read and fetch; the Console never downloads or
    // replaces anything, and the dictionary is where that promise would break.
    for (const locale of LOCALES) {
      const copy = translate(locale, 'update.releases')
      expect(copy.toLowerCase()).toContain('release')
      expect(copy.toLowerCase()).not.toContain('download')
    }
  })
})

/**
 * The service's codes, and the page's words for them (#47).
 *
 * The contract exports all four vocabularies as runtime tuples — refusals,
 * prerequisites, explained reasons and verdicts — precisely so this loop can be
 * exhaustive: a code added to `web/api-types.ts` without a message is a failure
 * here, in both locales, not an English sentence discovered in a browser. The
 * `Record<Code, MessageKey>` maps are what tie a code to a key at compile time;
 * this is the data half of the same promise.
 */
describe('every service code has copy in both locales', () => {
  const codeKeys: [string, MessageKey][] = [
    ...REFUSAL_CODES.map((code): [string, MessageKey] => [
      `refusal:${code}`,
      REFUSAL_MESSAGE_KEYS[code],
    ]),
    ...PREREQUISITE_CODES.map((code): [string, MessageKey] => [
      `prerequisite:${code}`,
      PREREQUISITE_MESSAGE_KEYS[code],
    ]),
    ...EXPLAINED_REASON_KINDS.map((kind): [string, MessageKey] => [
      `explained:${kind}`,
      EXPLAINED_REASON_MESSAGE_KEYS[kind],
    ]),
    ...CONSOLE_VERDICTS.map((code): [string, MessageKey] => [
      `verdict:${code}`,
      VERDICT_MESSAGE_KEYS[code],
    ]),
  ]

  it('covers the whole vocabulary the contract exports', () => {
    // A mapping that dropped a code would be a `tsc` error; this states the
    // intent from the other side, so a tuple that quietly lost a member fails.
    expect(codeKeys).toHaveLength(
      REFUSAL_CODES.length +
        PREREQUISITE_CODES.length +
        EXPLAINED_REASON_KINDS.length +
        CONSOLE_VERDICTS.length,
    )
    expect([...REFUSAL_CODES]).toEqual([
      'run-busy',
      'orphaned-run',
      'missing-prerequisite',
      'exit-confirm-required',
    ])
    expect([...PREREQUISITE_CODES]).toEqual(['env-file'])
    expect([...CONSOLE_VERDICTS]).toEqual(['clean', 'explained', 'defect'])
  })

  it('resolves each code to written-out copy in zh-CN and en', () => {
    for (const [code, key] of codeKeys) {
      for (const locale of LOCALES) {
        expect(translate(locale, key).trim(), `${code} in ${locale}`).not.toBe('')
      }
    }
  })

  it('gives every code its own message rather than sharing one', () => {
    const keys = codeKeys.map(([, key]) => key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

/**
 * The page's exit (#96). Three sentences carry the whole promise: the control
 * says "exit", a Run in flight asks first and names the consequence the next
 * start meets, and the page ends on "exited — you can close this page". The
 * confirmation is the service's refusal surfaced, so both locales have to say
 * the same thing about the truncated Run log.
 */
describe('the page’s exit', () => {
  it('names the exit in the navigation, in both locales', () => {
    for (const locale of LOCALES) {
      expect(translate(locale, 'nav.exit').trim()).not.toBe('')
    }
    expect(translate('zh-CN', 'nav.exit')).toBe('退出')
    expect(translate('en', 'nav.exit')).toBe('Exit')
  })

  it('says what an exit during a fetch costs the next start, in both locales', () => {
    for (const locale of LOCALES) {
      const confirm = translate(locale, 'exit.confirmBody')
      const notice = translate(locale, 'exit.exitedInterrupted')
      expect(confirm, `${locale}: ${confirm}`).toMatch(locale === 'zh-CN' ? /截断/ : /truncat/i)
      expect(confirm, `${locale}: ${confirm}`).toMatch(locale === 'zh-CN' ? /清理/ : /clean up/i)
      expect(notice, `${locale}: ${notice}`).toMatch(locale === 'zh-CN' ? /截断/ : /truncat/i)
    }
  })

  it('ends on the page’s last instruction after a successful exit', () => {
    // The spec's own words, so the notice cannot drift into a spinner.
    expect(translate('zh-CN', 'exit.exitedHeading')).toBe('已退出 — 可以关闭这个页面')
    expect(translate('en', 'exit.exitedHeading')).toBe('Exited — you can close this page')
  })

  it('gives the confirmation refusal its own sentence', () => {
    for (const locale of LOCALES) {
      expect(translate(locale, 'refusal.exitConfirmRequired').trim()).not.toBe('')
    }
  })
})

/**
 * The wall's figures line (#94): one line, each count its own data cell, and
 * the same sentence the Run panel shows. The numbers are
 * `web/src/lib/gallery-figures.ts`'s; the dictionary owes the words and the
 * separators, in both locales, and the exact English the acceptance criteria
 * name.
 */
describe('the wall’s figures line', () => {
  it('names the three counts in one line, in both locales', () => {
    const params = { officialTotal: 1013, downloaded: 1001, missing: 12 }
    for (const locale of LOCALES) {
      const copy = translate(locale, 'gallery.figures', params)
      expect(copy, `${locale}: ${copy}`).toContain('1013')
      expect(copy, `${locale}: ${copy}`).toContain('1001')
      expect(copy, `${locale}: ${copy}`).toContain('12')
      expect(copy, `${locale}: ${copy}`).toContain('·')
    }
    expect(translate('en', 'gallery.figures', params)).toBe(
      'Gallery 1013 · downloaded 1001 · missing 12',
    )
  })

  it('offers the extra count as its own clause, appended only when extras exist', () => {
    for (const locale of LOCALES) {
      const copy = translate(locale, 'gallery.figuresExtra', { extra: 3 })
      expect(copy, `${locale}: ${copy}`).toContain('3')
      expect(copy, `${locale}: ${copy}`).toContain('·')
    }
    expect(translate('en', 'gallery.figuresExtra', { extra: 3 })).toBe(' · extra 3')
  })

  it('says the list is unread, in both locales, and never a missing count', () => {
    expect(translate('en', 'gallery.unread')).toBe('Gallery unread')
    expect(translate('zh-CN', 'gallery.unread')).not.toBe('')
    expect(translate('zh-CN', 'gallery.unread')).not.toBe(translate('en', 'gallery.unread'))
  })
})

/**
 * The first-run wall (#83). A fresh install shows an empty wall, and an empty
 * wall has to explain itself instead of looking broken: one obvious action, one
 * honest line about the size of the first fetch, and no suggestion that
 * anything starts by itself. These pin the *numbers* and the promises, because
 * those are what a reader decides on — "about 2 GB" is the whole point.
 */
describe('the first-run wall', () => {
  it('names the scale of the first fetch in numbers, in both locales', () => {
    for (const locale of LOCALES) {
      const copy = translate(locale, 'wall.emptyScale')
      // About 1000+ wallpapers, about 2 GB, 10–40 minutes: three numbers, never
      // an adjective ("large", "a while", "some time").
      expect(copy, `${locale}: ${copy}`).toMatch(/1[,.]?000/)
      expect(copy, `${locale}: ${copy}`).toContain('2 GB')
      expect(copy, `${locale}: ${copy}`).toContain('10')
      expect(copy, `${locale}: ${copy}`).toContain('40')
    }
  })

  it('says the reader starts it, and nothing starts on its own', () => {
    for (const locale of LOCALES) {
      const copy = translate(locale, 'wall.emptyBody')
      expect(copy, `${locale}: ${copy}`).toMatch(
        locale === 'zh-CN' ? /只有你|不会自己/ : /until you|never starts|on its own/i,
      )
    }
  })

  it('says an interruption resumes rather than restarts, in both locales', () => {
    for (const locale of LOCALES) {
      const before = translate(locale, 'wall.emptyResumeHint')
      const after = translate(locale, 'wall.resumeBody', { remaining: 710 })
      expect(before, `${locale}: ${before}`).toMatch(locale === 'zh-CN' ? /跳过/ : /skip/i)
      expect(after, `${locale}: ${after}`).toMatch(locale === 'zh-CN' ? /跳过/ : /skip/i)
      // The resume band names what is still missing; "N of M" alone leaves the
      // reader doing subtraction.
      expect(after, `${locale}: ${after}`).toContain('710')
    }
  })

  it('names both counts in the progress sentence, not a spinner', () => {
    for (const locale of LOCALES) {
      const copy = translate(locale, 'wall.progress', { done: 300, total: 1010 })
      expect(copy, `${locale}: ${copy}`).toContain('300')
      expect(copy, `${locale}: ${copy}`).toContain('1010')
    }
  })

  it('offers one action for an empty wall and the continue action for a resume', () => {
    for (const locale of LOCALES) {
      expect(translate(locale, 'wall.start')).not.toBe('')
      expect(translate(locale, 'wall.continue')).not.toBe('')
      expect(translate(locale, 'wall.start')).not.toBe(translate(locale, 'wall.continue'))
    }
  })
})

/**
 * The three verdicts (#83). Their meanings do not move — clean / explained /
 * defect stay what `assessRun` decided — but the page's words for them are a
 * player's, not a maintainer's: no service code, and none of the internal terms
 * the old labels used.
 */
describe('the verdicts in the reader’s words', () => {
  it('never shows the service’s verdict code', () => {
    for (const code of CONSOLE_VERDICTS) {
      const label = translate('en', VERDICT_MESSAGE_KEYS[code])
      expect(label.toLowerCase(), `${code}: ${label}`).not.toContain(code)
    }
  })

  it('does not reuse the internal Chinese terms', () => {
    for (const code of CONSOLE_VERDICTS) {
      const label = translate('zh-CN', VERDICT_MESSAGE_KEYS[code])
      expect(['干净', '已解释', '缺陷'], `${code}: ${label}`).not.toContain(label)
    }
  })

  it('says clean means nothing went wrong', () => {
    expect(translate('zh-CN', VERDICT_MESSAGE_KEYS.clean)).toMatch(/完成|没有发现问题/)
    expect(translate('en', VERDICT_MESSAGE_KEYS.clean).toLowerCase()).toMatch(
      /nothing wrong|no problem|finished/,
    )
  })

  it('says explained means routine notes, not a failure', () => {
    expect(translate('zh-CN', VERDICT_MESSAGE_KEYS.explained)).toMatch(/常规/)
    expect(translate('zh-CN', VERDICT_MESSAGE_KEYS.explained)).toMatch(/不算失败/)
    expect(translate('en', VERDICT_MESSAGE_KEYS.explained).toLowerCase()).toMatch(/routine/)
    expect(translate('en', VERDICT_MESSAGE_KEYS.explained).toLowerCase()).toMatch(
      /not failures|not a failure/,
    )
  })

  it('says defect means something went wrong', () => {
    expect(translate('zh-CN', VERDICT_MESSAGE_KEYS.defect)).toMatch(/问题/)
    expect(translate('en', VERDICT_MESSAGE_KEYS.defect).toLowerCase()).toMatch(/wrong|problem/)
  })
})

/**
 * A failure, in one human sentence (#83): an offline machine or an unreachable
 * site must not print a stack, an `HTTP 500` or a transport message at a player.
 * The copy below is what stands between them and one of those, so it is held to
 * the same bar in both languages — and it has to say what to do next, which is
 * what makes the retry control beside it make sense.
 */
describe('a failure speaks plainly', () => {
  const failureKeys: MessageKey[] = [
    'wall.readFailed',
    'run.siteUnreachable',
    'error.connection',
    'console.readFailed',
  ]

  it('never prints a stack, an HTTP status or a transport code', () => {
    for (const key of failureKeys) {
      for (const locale of LOCALES) {
        const copy = translate(locale, key)
        expect(copy, `${key} in ${locale}`).not.toMatch(
          /HTTP\s?\d|\berrno\b|ECONN|ETIMEDOUT|at \w+\.\w+|stack/i,
        )
      }
    }
  })

  it('offers a retry affordance in words', () => {
    for (const locale of LOCALES) {
      expect(translate(locale, 'action.retry')).not.toBe('')
      expect(translate(locale, 'run.siteUnreachable')).toMatch(
        locale === 'zh-CN' ? /再抓|重试/ : /try again|fetch again/i,
      )
    }
  })
})
