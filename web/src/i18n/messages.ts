// ── The page's dictionary ───────────────────────────────────────────
//
// Every word this page says, in both languages it speaks. The keys are English
// — the language the code, the comments and the contracts are written in — and
// the two dictionaries are complete: there is no fallback chain, so a key that
// exists in one locale and not the other fails `tsc` here (the English
// dictionary carries `satisfies Record<MessageKey, string>`, which rejects a
// missing key *and* an extra one) as well as the parity test in
// `tests/web/i18n/messages.test.ts`. A Chinese sentence can therefore never
// surface inside the English page as a surprise at runtime.
//
// This module is pure data plus a lookup: no Vue, no DOM, no `localStorage`.
// Which locale the page is in, and what a switch does to `<html lang>` and
// `document.title`, live in `web/src/i18n/locale.ts`, so this seam stays
// collectable by the test runner without a DOM environment.
//
// The hand-rolled dictionary instead of `vue-i18n` is docs/adr/0014. The short
// version: 40-odd messages, two languages, no pluralisation rules and no
// message-format syntax beyond `{name}`; a framework would add a runtime, a
// plugin and a second way to name a string, and the page needs none of it.

/** The locales the page speaks, in the order the switch offers them. */
export const LOCALES = ['zh-CN', 'en'] as const

/** A locale the page has messages for. */
export type Locale = (typeof LOCALES)[number]

/** Chinese first: the page opens in the language its reader reads. */
export const DEFAULT_LOCALE: Locale = 'zh-CN'

/**
 * The Chinese dictionary — the canonical shape, whose `keyof` is `MessageKey`.
 * A message this file does not carry therefore cannot be asked for: `t()` takes
 * a `MessageKey`, and a typo is a compile error rather than a blank line at
 * runtime.
 */
const zhCN = {
  // The page itself.
  'app.title': '壁纸图鉴',
  'app.readingMirror': '正在读取镜像……',
  'app.wallpapersInMirror': '镜像中有 {count} 张壁纸',
  'app.mirrorAgainstTotal': '镜像中有 {count} 张壁纸,官方总数为 {total}',

  // The language switch. The two language names are written in their own
  // language — a switch that says 中文 only in Chinese is unusable to the
  // reader who needs it — so both locales carry the same two words here.
  'language.label': '界面语言',
  'language.chinese': '中文',
  'language.english': 'English',

  // The Run panel. The values that come from the service — the verdict's own
  // reasons and the defect names — are still its English prose until ticket #47
  // turns them into codes (docs/adr/0014); what is here is the panel's own
  // words around them.
  'run.heading': '运行',
  'run.readingLog': '正在读取运行日志……',
  'run.inFlight': '有一个运行正在进行:{progress}。',
  'run.noLog': '尚未读取到任何运行日志。',
  'run.line': '运行 {runId} — 结论:{verdict}',
  'run.why': '原因:{causes}',
  'run.causeSeparator': ';',
  'run.cause.stateNamesAnotherRun': '官方状态指向另一个运行',
  'run.cause.stateUnreadable': '官方状态读取失败,无法与报告比对',
  'run.cause.missingOnDisk': '报告声称的新文件在磁盘上缺失:{files}',
  'run.explained': '已解释(常规情形,记录在案而非判为失败):',
  'run.gallery': '官方清单:{line}',
  'run.galleryReport':
    '官方总数 {officialTotal} · 上次运行后新增 {newSinceLastRun} · 新增文件 {newFiles}',
  'run.download': '下载:{line}',
  'run.downloadReport': '成功 {ok} · 跳过 {skipped} · 失败 {failed} · 成功率 {successRate}',
  'run.unknown': '未知',
  'run.defects': '缺陷:',
  'run.reportMissing': '运行日志停在运行报告之前 — 这是日志的缺陷,不是运行失败的证据。',
  'run.reportUnreadable':
    '运行日志带有本控制台读不懂的运行报告 — 旧版运行契约?这既不是报告缺失,也不证明运行失败。',
  'run.start': '开始运行',
  'run.refusedStart': '本地控制台拒绝启动(HTTP {status})',

  // The verdict is `check-run`'s three-state enum, mapped here because the page
  // owns every word the reader sees (docs/adr/0014).
  'verdict.clean': '干净',
  'verdict.explained': '已解释',
  'verdict.defect': '缺陷',

  // The Orphaned Run panel: the one state with an action, so its copy has to
  // explain both what cleaning up does and what it refuses to do.
  'orphan.line': '孤儿运行 {runId} — 运行日志 {logName} 没有运行报告,且是最近写入的。',
  'orphan.newestLog': '它最新的运行日志',
  'orphan.explanation':
    '清理是可选项,不是强制项:它可能仍是一个正在写入的运行,而仅凭日志目录分不清这两种情况。清理会关闭残留的浏览器会话并撤回这条提示;运行日志本身永不修改、也不删除,因为它是这次运行的审计轨迹。',
  'orphan.clean': '清理',
  'orphan.refusedCleanup': '本地控制台拒绝清理(HTTP {status})',

  // The gallery: the official list read against the Mirror, and the three
  // states a row can be in.
  'gallery.heading': '官方清单',
  'gallery.reading': '正在读取官方清单……',
  'gallery.counts': '官方清单有 {officialTotal} 条;镜像有 {mirrorCount} 个文件。',
  'gallery.notRead': '未读取到',
  'gallery.newestRunAdded': '最近一次运行新增了 {newSinceLastRun} 条。',
  'gallery.listUnavailable':
    '官方清单没有读到,所以这里只显示镜像里的文件:哪些壁纸缺失无从判断,这里的数字也不是缺失的数量。',
  'gallery.mirrorGap':
    '官方清单中列出、镜像里却没有的壁纸有 {missing} 张;镜像里有 {extra} 个文件已不在官方清单中。',
  'gallery.tileShow': '全尺寸查看 {name}',
  'gallery.tileNotOnDisk': '{name} 未落盘',
  'gallery.notOnDisk': '未落盘',
  'gallery.state.onDisk': '已落盘',
  'gallery.state.missing': '缺失',
  'gallery.state.notInGallery': '已不在官方清单',

  // The fullscreen viewer.
  'viewer.galleryId': '官方 id {id}',
  'viewer.close': '关闭(Esc)',
  'viewer.missingFile': '该文件已不在镜像中。',
} as const

/**
 * Every message key, English. Derived from the canonical dictionary rather
 * than kept beside it: a second hand-written list of keys is one more thing
 * that can disagree with the messages themselves.
 */
export type MessageKey = keyof typeof zhCN

/** The values a message interpolates for the `{name}` parts of its text. */
export type MessageParams = Record<string, string | number | undefined>

/**
 * The English dictionary, key for key. Written out rather than generated or
 * defaulted, because the point of the exercise is that the English page reads
 * like English and not like a translation key — and `satisfies` is what makes
 * the compiler hold it to the Chinese dictionary's key set: both a key this
 * object forgot and a key the canonical dictionary does not name are errors
 * here, not a string the page discovers it is missing.
 */
const en = {
  'app.title': 'Wallpaper Gallery',
  'app.readingMirror': 'Reading the Mirror…',
  'app.wallpapersInMirror': '{count} Wallpapers in the Mirror',
  'app.mirrorAgainstTotal': '{count} Wallpapers in the Mirror against a Gallery total of {total}',

  'language.label': 'Interface language',
  'language.chinese': '中文',
  'language.english': 'English',

  'run.heading': 'Run',
  'run.readingLog': 'Reading the Run log…',
  'run.inFlight': 'A Run is in flight: {progress}.',
  'run.noLog': 'No Run log has been read.',
  'run.line': 'Run {runId} — verdict: {verdict}',
  'run.why': 'Why: {causes}',
  'run.causeSeparator': '; ',
  'run.cause.stateNamesAnotherRun': 'the Gallery state names another Run',
  'run.cause.stateUnreadable':
    'the Gallery state could not be read, so the report was not matched against it',
  'run.cause.missingOnDisk': 'claimed new files missing on disk: {files}',
  'run.explained': 'Explained (routine, recorded rather than failed):',
  'run.gallery': 'Gallery: {line}',
  'run.galleryReport':
    'officialTotal {officialTotal}, newSinceLastRun {newSinceLastRun}, newFiles {newFiles}',
  'run.download': 'Download: {line}',
  'run.downloadReport': 'ok {ok}, skipped {skipped}, failed {failed}, successRate {successRate}',
  'run.unknown': 'unknown',
  'run.defects': 'Defects:',
  'run.reportMissing':
    'The Run log stops before its Run report — a defect in the log, not proof the Run failed.',
  'run.reportUnreadable':
    'The Run log carries a Run report this Console cannot read — an older Run contract? Not a missing report, and not proof the Run failed.',
  'run.start': 'Start a Run',
  'run.refusedStart': 'the Console refused the start (HTTP {status})',

  'verdict.clean': 'clean',
  'verdict.explained': 'explained',
  'verdict.defect': 'defect',

  'orphan.line':
    'Orphaned Run {runId} — the Run log {logName} has no Run report and was written recently.',
  'orphan.newestLog': 'its newest Run log',
  'orphan.explanation':
    "Cleaning it up is offered, not forced: it may still be a Run that is writing, and the log directory alone cannot tell the two apart. The cleanup closes the leftover Browser session and withdraws this notice; the Run log itself is never edited or deleted, because it is the Run's audit trail.",
  'orphan.clean': 'Clean up',
  'orphan.refusedCleanup': 'the Console refused the cleanup (HTTP {status})',

  'gallery.heading': 'Gallery list',
  'gallery.reading': 'Reading the Gallery list…',
  'gallery.counts':
    'The Gallery list holds {officialTotal} entries; the Mirror holds {mirrorCount} files.',
  'gallery.notRead': 'not read',
  'gallery.newestRunAdded': 'The newest Run added {newSinceLastRun}.',
  'gallery.listUnavailable':
    "The Gallery list was not read, so this view shows the Mirror's files alone: nothing can be said about which Wallpapers are missing, and nothing here is a count of them.",
  'gallery.mirrorGap':
    '{missing} listed Wallpapers are missing from the Mirror; {extra} Mirror files are not in the gallery any more.',
  'gallery.tileShow': 'Show {name} at full size',
  'gallery.tileNotOnDisk': '{name} is not on disk',
  'gallery.notOnDisk': 'not on disk',
  'gallery.state.onDisk': 'on disk',
  'gallery.state.missing': 'missing',
  'gallery.state.notInGallery': 'not in the gallery',

  'viewer.galleryId': 'Gallery id {id}',
  'viewer.close': 'Close (Esc)',
  'viewer.missingFile': 'That file is no longer in the Mirror.',
} satisfies Record<MessageKey, string>

const dictionaries: Record<Locale, Record<MessageKey, string>> = { 'zh-CN': zhCN, en }

/** `true` when a stored or configured value is a locale the page can speak. */
export function isLocale(value: string | null | undefined): value is Locale {
  return LOCALES.some(locale => locale === value)
}

/** The whole message set for one locale. */
export function messagesFor(locale: Locale): Readonly<Record<MessageKey, string>> {
  return dictionaries[locale]
}

const PLACEHOLDER = /\{(\w+)\}/g

/**
 * One message, in one language, with its parameters filled in. A parameter the
 * message does not name is ignored, and a placeholder with no parameter is left
 * as written — visible in the page as `{count}` rather than silently dropped.
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const message = dictionaries[locale][key]
  if (params === undefined) return message
  return message.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = params[name]
    return value === undefined ? placeholder : String(value)
  })
}
