// ── The page's dictionary ───────────────────────────────────────────
//
// Every word this page says, in both languages it speaks. The keys are English
// — the language the code, the comments and the contracts are written in — and
// the two dictionaries are complete: there is no fallback chain, so a key that
// exists in one locale and not the other fails `tsc` here (the English
// dictionary carries `satisfies Record<MessageKey, string>`, which rejects a
// missing key *and* an extra one) as well as the parity test in
// `tests/web/src/i18n/messages.test.ts`. A Chinese sentence can therefore never
// surface inside the English page as a surprise at runtime.
//
// This module is pure data plus a lookup: no Vue, no DOM, no `localStorage`.
// The lookup returns a message whole (`translate`) or split at its parameters
// (`translateParts`), which is how a value inside a sentence takes the numeral
// role without markup entering the dictionary (`web/src/i18n/Message.vue`).
// Which locale the page is in, and what a switch does to `<html lang>` and
// `document.title`, live in `web/src/i18n/locale.ts`, so this seam stays
// collectable by the test runner without a DOM environment.
//
// The hand-rolled dictionary instead of `vue-i18n` is docs/adr/0014. The short
// version: 40-odd messages, two languages, no pluralisation rules and no
// message-format syntax beyond `{name}`; a framework would add a runtime, a
// plugin and a second way to name a string, and the page needs none of it.

import type { ConsoleVerdict, PrerequisiteCode, RefusalCode } from '../../api-types.js'

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

  // The language switch. The two language names are written in their own
  // language — a switch that says 中文 only in Chinese is unusable to the
  // reader who needs it — so both locales carry the same two words here.
  'language.label': '界面语言',
  'language.chinese': '中文',
  'language.english': 'English',

  // The floating navigation, and the drawer it opens (#48). The nav carries the
  // product name, the one number that answers "is there anything new", the
  // language switch and the way into the Run panel; the panel itself moved into
  // a layer, so the wall is the page. The mirror count is a data cell and
  // renders through `Message.vue`, as every count does.
  'nav.mirrorCount': '镜像 {count}',
  'nav.run': '运行',
  // The one number a reader quotes when reporting a problem (#79). The version
  // is a data cell, so the sentence takes it as a `{version}` parameter and
  // `Message.vue` renders it in the numeral role.
  'nav.version': '版本 {version}',
  // #96: the page's way out — the one control that stops the program, next to
  // the drawer's Run facts. Quiet on purpose: it is not an action a reader takes
  // often, and it must not compete with the start.
  'nav.exit': '退出',
  // The confirmation, shown only when the service refuses an unconfirmed exit
  // because a Run is in flight — the page never decides that for itself. The
  // body says the consequence the next start will meet, not a generic "are you
  // sure": a truncated Run log is the thing the reader has to clean up.
  'exit.confirmTitle': '退出程序?',
  'exit.confirmBody':
    '有一个运行正在进行。现在退出会停止服务,并可能中断这次运行:运行日志会被截断,下次启动时需要在运行面板里清理这条中断的记录。确定要退出吗?',
  'exit.confirmAction': '退出',
  'exit.cancelAction': '继续运行',
  // After the service accepted the exit. The heading is the whole instruction:
  // the page is done, and a tab left open cannot do anything else.
  'exit.exitedHeading': '已退出 — 可以关闭这个页面',
  'exit.exitedBody': '程序已经停止,可以关闭这个页面了。',
  // When a Run was in flight at the exit: the page cannot know whether this
  // Console started it, so it states both consequences rather than claiming a
  // kill (the terminal, which does know, says the precise one).
  'exit.exitedInterrupted':
    '程序已经停止。退出时有一个运行正在进行:如果它是由本程序启动的,它已经停止、运行日志被截断,下次启动时请在运行面板里清理这条中断的记录;如果它是在别的终端里启动的,它可能还在继续写入。',
  'exit.failed': '没能退出:本地控制台没有接受这次请求。刷新页面后再试一次。',
  'update.available': '有新版本 {version}',
  'update.releases': 'Releases 页面',
  'drawer.title': '运行面板',
  'drawer.close': '关闭(Esc)',

  // The Run panel (#97) holds four lines: one verdict sentence, `ok N · failed N`,
  // the figures line the wall's header shows (#94), and at most one problem line.
  // The run id, the timestamps, the Discovery counters, the success rate, the
  // defect rows and the routine notes are not here because the panel no longer
  // shows them — what is here is the whole of what it says.
  'run.heading': '运行',
  'run.readingLog': '正在读取运行日志……',
  'run.noLog': '尚未读取到任何运行日志。',
  // The counts line: `ok N`, and the failure clause only when something failed
  // (#97). The clause carries its own separator, so the line reads
  // `ok 1013 · failed 3` — and `ok 1013` when nothing failed.
  'run.counts': '成功 {ok}',
  'run.countsFailed': ' · 失败 {failed}',
  // The verdict's own causes: the last branch of the one problem line, shown one
  // at a time. The `reasons:` clause that joined them all retired (#97); the
  // separator stays because a refusal's missing prerequisites still join with it.
  'run.causeSeparator': ';',
  'run.cause.stateNamesAnotherRun': '官网记录和这次运行对不上(可能来自另一次运行)',
  'run.cause.stateUnreadable': '官网记录没读到,没法核对这次运行',
  'run.cause.missingOnDisk': '记录里说新下载了这些文件,磁盘上却找不到:{files}',
  'run.reportMissing': '这次运行的记录没有写完,所以得不出结论。可以再抓一次;已经下载好的会跳过。',
  'run.reportUnreadable': '这次运行的记录是旧格式,这个页面读不懂,所以得不出结论。',
  'run.refusedStart': '没能开始抓取:本地控制台没有接受这次请求。刷新页面后再试一次。',
  // The site never answered: one sentence, and the start control below it is the
  // retry. It replaced the defect row that said the same thing without an action
  // (#97).
  'run.siteUnreachable': '连不上官网,这次一张也没能拿到。检查网络后再抓一次。',
  // The setup notice (#60, #95): with no usable `.env` the panel says why a Run
  // cannot start, and gives the one line to write — two lines, no more. The file
  // is the `.env` **beside the program**, because a Portable package is unzipped
  // anywhere and has no repository root; the file name is a data cell, so it
  // travels as a parameter. Nothing here says "refresh the page": creating the
  // file and reopening the panel (or returning to the window) is enough, because
  // the page re-reads the status (#95). The line is the site's constant, not
  // translatable prose, and is the same line README.md's quick start gives.
  'run.setup.body': '程序旁边没有可用的 {file},所以还不能开始运行;补上下面这一行就可以了。',
  'run.setup.lines': 'BASE_ORIGIN=https://re.bluepoch.com',

  // The verdict is `check-run`'s three-state enum, mapped here because the page
  // owns every word the reader sees (docs/adr/0014). #83 puts them in a
  // player's words: the service code and the old internal labels (干净 / 已解释 /
  // 缺陷) are gone from the page, and each line says what it means for the wall.
  'verdict.clean': '全部完成,没有发现问题',
  'verdict.explained': '完成,有几处常规情况已记录,不算失败',
  'verdict.defect': '出现了问题',

  // The Orphaned Run: one sentence and the cleanup control (#97). The long
  // explanation paragraph retired; what a cleanup does not do is the refusal's
  // business, not a paragraph's.
  'orphan.line': '孤儿运行 {runId} — 运行日志 {logName} 没有运行报告,且是最近写入的。',
  'orphan.newestLog': '它最新的运行日志',
  'orphan.clean': '清理',
  'orphan.refusedCleanup': '本地控制台没有接受这次清理。刷新页面后再试一次。',

  // The gallery: the Mirror's Wallpapers, and the one line that answers "is the
  // Mirror complete?" (#94). The figures line is shared by the wall header and
  // the Run panel, so the two cannot disagree about the same numbers; every
  // count is a data cell. `gallery.unread` is the honest answer when the list
  // could not be read: no missing count is claimed.
  'gallery.heading': '官方清单',
  // The wall's display mark: a logotype, not a phrase, so it is the same word
  // in both locales and is translated nowhere (docs/adr/0015, story 20).
  'wall.mark': 'WALLPAPER',
  'gallery.reading': '正在读取官方清单……',
  'gallery.figures': '官方清单 {officialTotal} · 已下载 {downloaded} · 缺失 {missing}',
  // Appended to the line only when the Mirror holds retired files: a leading
  // separator of its own, so the sentence is the whole clause.
  'gallery.figuresExtra': ' · 本地多出 {extra}',
  'gallery.unread': '官方清单未读取',
  'gallery.newestRunAdded': '最近一次运行新增了 {newSinceLastRun} 条。',
  'gallery.tileShow': '全尺寸查看 {name}',

  // ── The wall's own band (#83) ─────────────────────────────────────
  //
  // An empty wall explains itself and hands the reader the one action that
  // matters; a wall with downloads speaks in counts, and says an interruption
  // continues rather than restarts. The scale of the first fetch is numbers,
  // not adjectives: about 1000+ Wallpapers, about 2 GB, 10–40 minutes. Nothing
  // here offers a way to start automatically — the button is the only start.
  'wall.start': '开始抓取',
  'wall.continue': '继续抓取',
  'wall.retryStart': '再抓一次',
  'wall.emptyHeading': '墙上还没有壁纸',
  'wall.emptyBody': '点下面的按钮开始抓取:只有你点下去,它才会开始,程序不会自己动。',
  'wall.emptyScale': '首次大约要下载 1000 多张壁纸,合计约 2 GB;按常见网速,大概 10–40 分钟。',
  'wall.progress': '已下载 {done} / 共 {total} 张',
  'wall.progressUnknownTotal': '已下载 {done} 张(官网总数还没读到)',
  'wall.emptyResumeHint': '以后中途关掉窗口也没关系:下次打开点「继续抓取」,已经下载好的会跳过。',
  'wall.resumeBody':
    '还差 {remaining} 张。再点「继续抓取」会从上次停下的地方接着下载:已经下载好的会跳过,不会从头再来。',
  'wall.runningHeading': '正在抓取壁纸…',
  'wall.runningHint': '关闭窗口即停止;下次打开点「继续抓取」,已经下载好的会跳过。',
  'wall.interruptedHeading': '上次抓取中断了',
  'wall.interruptedBody':
    '先打开导航上的「运行」面板,清理上次中断留下的记录,然后就能接着抓;已经下载好的会跳过。',
  'wall.readFailed': '没能读到本地控制台的数据。',

  // A failure, in one human sentence (#83): no stack, no HTTP status, no
  // transport message ever reaches the reader. Each line says what happened and
  // what to do next, and the retry control beside it does that action.
  'action.retry': '重试',
  'console.readFailed': '没读到本地控制台的数据。确认程序还在运行,然后重试。',
  'error.connection': '和本地控制台的连接断了。刷新页面后再试一次。',

  // The fullscreen viewer.
  'viewer.galleryId': '官方 id {id}',
  'viewer.close': '关闭(Esc)',
  'viewer.missingFile': '该文件已不在镜像中。',
  // The control pill (#48). Zoom is a factor of the height-fitted image, and the
  // percentage beside the controls is the page's own reading of it — a data
  // cell, so it takes the numeral role like every other number here.
  'viewer.zoomOut': '缩小',
  'viewer.zoomIn': '放大',
  'viewer.reset': '复位',
  'viewer.zoomPercent': '缩放 {percent}%',

  // ── The service's codes (#47) ─────────────────────────────────────
  //
  // The service stops writing prose and starts emitting a stable code plus its
  // parameters; these are the page's words for them, in both languages. The
  // `Record<Code, MessageKey>` maps below are what tie a code to a key at
  // compile time, and the dictionary test walks the contract's vocabularies to
  // prove every code resolves here. The refusal sentences explain the rule;
  // the prerequisite names are what the reader has to install.

  'refusal.runBusy': '已有一个运行正在进行:两个运行会同时写同一个镜像与日志目录,互相摧毁状态。',
  'refusal.orphanedRun':
    '存在一个孤儿运行:它的运行日志没有运行报告,且是最近写入的,所以它可能仍在写入。如果它只是残留,请先在页面上清理;之后才能开始新的运行。',
  'refusal.missingPrerequisite': '缺少前置条件:{missing}',
  // #96: the page's exit while a Run is in flight. The page turns this into its
  // confirmation question; the service never writes the sentence.
  'refusal.exitConfirmRequired': '有一个运行正在进行:要退出,请再确认一次。',

  'prerequisite.envFile': '.env 配置文件',

  // The Run report's defects, as the four sentences the panel's one problem line
  // can say (#97). The nine-row list went with the rest of the panel's log dump;
  // these remain because the priority in `web/src/lib/run-panel.ts` names them,
  // and `defect.none` went too: a clean Run's verdict sentence already says so,
  // and a second "nothing went wrong" line was the noise #97 removed.
  'defect.emptyFiles': '有文件是空的:{files}',
  'defect.persistentFailures': '{count} 张反复下载失败',
  'defect.emptyResult': '一张壁纸也没找到',
  'defect.mirrorGapMissing': '官网列出的 {count} 张壁纸还没下载',
} as const

/**
 * Every message key, English. Derived from the canonical dictionary rather
 * than kept beside it: a second hand-written list of keys is one more thing
 * that can disagree with the messages themselves.
 */
export type MessageKey = keyof typeof zhCN

/** The values a message interpolates for the `{name}` parts of its text. */
export type MessageParams = Record<string, string | number | undefined>

/** One dictionary row: a message key and the values it interpolates. */
export interface MessageRow {
  key: MessageKey
  params?: MessageParams
}

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

  'language.label': 'Interface language',
  'language.chinese': '中文',
  'language.english': 'English',

  'nav.mirrorCount': 'Mirror {count}',
  'nav.run': 'Run',
  'nav.version': 'version {version}',
  'nav.exit': 'Exit',
  'exit.confirmTitle': 'Exit the program?',
  'exit.confirmBody':
    'A Run is in flight. Exiting now stops the service and may interrupt it: its Run log is truncated, and the next start needs to clean up the interrupted record. Exit anyway?',
  'exit.confirmAction': 'Exit',
  'exit.cancelAction': 'Keep running',
  'exit.exitedHeading': 'Exited — you can close this page',
  'exit.exitedBody': 'The program has stopped. You can close this page.',
  'exit.exitedInterrupted':
    'The program has stopped. A Run was in flight: if this program started it, it has stopped and its Run log is truncated — clean up the interrupted record on the next start. If it was started in another terminal, it may still be writing.',
  'exit.failed': 'The Console did not accept the exit. Refresh the page and try again.',
  'update.available': 'Version {version} is available',
  'update.releases': 'Releases page',
  'drawer.title': 'Run panel',
  'drawer.close': 'Close (Esc)',

  'run.heading': 'Run',
  'run.readingLog': 'Reading the Run log…',
  'run.noLog': 'No Run log has been read.',
  'run.counts': 'ok {ok}',
  'run.countsFailed': ' · failed {failed}',
  'run.causeSeparator': '; ',
  'run.cause.stateNamesAnotherRun':
    'the site record does not match this Run (it may belong to another Run)',
  'run.cause.stateUnreadable':
    'the site record could not be read, so this Run was not cross-checked',
  'run.cause.missingOnDisk':
    'the log says these files were downloaded, but they are not on disk: {files}',
  'run.reportMissing':
    'This Run’s log stops before its report, so there is no verdict. You can fetch again; wallpapers already downloaded are skipped.',
  'run.reportUnreadable':
    'This Run’s log uses an older format this page cannot read, so there is no verdict.',
  'run.refusedStart':
    'The fetch did not start: the Console did not accept the request. Refresh the page and try again.',
  'run.siteUnreachable':
    'The site could not be reached, so nothing was downloaded. Check the connection and fetch again.',
  'run.setup.body':
    'There is no usable {file} beside the program, so a Run cannot start; add the line below.',
  'run.setup.lines': 'BASE_ORIGIN=https://re.bluepoch.com',

  'verdict.clean': 'Finished — nothing wrong',
  'verdict.explained': 'Finished — a few routine notes, not failures',
  'verdict.defect': 'Something went wrong',

  'orphan.line':
    'Orphaned Run {runId} — the Run log {logName} has no Run report and was written recently.',
  'orphan.newestLog': 'its newest Run log',
  'orphan.clean': 'Clean up',
  'orphan.refusedCleanup':
    'The Console did not accept the cleanup. Refresh the page and try again.',

  'gallery.heading': 'Gallery list',
  'wall.mark': 'WALLPAPER',
  'gallery.reading': 'Reading the Gallery list…',
  'gallery.figures': 'Gallery {officialTotal} · downloaded {downloaded} · missing {missing}',
  'gallery.figuresExtra': ' · extra {extra}',
  'gallery.unread': 'Gallery unread',
  'gallery.newestRunAdded': 'The newest Run added {newSinceLastRun}.',
  'gallery.tileShow': 'Show {name} at full size',

  'wall.start': 'Start the fetch',
  'wall.continue': 'Continue the fetch',
  'wall.retryStart': 'Fetch again',
  'wall.emptyHeading': 'The wall is empty for now',
  'wall.emptyBody':
    'Click the button below to start the fetch: nothing begins until you do — the program never starts on its own.',
  'wall.emptyScale':
    'The first fetch is about 1,000+ wallpapers and roughly 2 GB — 10–40 minutes at typical speeds.',
  'wall.progress': '{done} of {total} wallpapers downloaded',
  'wall.progressUnknownTotal': '{done} wallpapers downloaded (the Gallery total is not read yet)',
  'wall.emptyResumeHint':
    'If you close the window mid-fetch, open it again and continue — what is already downloaded is skipped.',
  'wall.resumeBody':
    '{remaining} wallpapers are still missing. “Continue the fetch” picks up where it stopped: what is already downloaded is skipped, not fetched twice.',
  'wall.runningHeading': 'Fetching wallpapers…',
  'wall.runningHint':
    'Closing the window stops the fetch; open it again and continue — what is already downloaded is skipped.',
  'wall.interruptedHeading': 'The last fetch was interrupted',
  'wall.interruptedBody':
    'Open the “Run” panel in the navigation, clear the record the interrupted fetch left behind, then continue — what is already downloaded is skipped.',
  'wall.readFailed': 'The Console data could not be read.',

  'action.retry': 'Try again',
  'console.readFailed':
    'The Console data could not be read. Check that the program is still running, then try again.',
  'error.connection': 'The connection to the Console was lost. Refresh the page and try again.',

  'viewer.galleryId': 'Gallery id {id}',
  'viewer.close': 'Close (Esc)',
  'viewer.missingFile': 'That file is no longer in the Mirror.',
  'viewer.zoomOut': 'Zoom out',
  'viewer.zoomIn': 'Zoom in',
  'viewer.reset': 'Reset',
  'viewer.zoomPercent': 'Zoom {percent}%',

  'refusal.runBusy':
    'A Run is already in flight: two Runs would write the same Mirror and log directory and destroy each other’s state.',
  'refusal.orphanedRun':
    'An Orphaned Run is present: its Run log has no Run report and was written recently, so it may still be writing. Clean it up from the page if it is a leftover; a new Run starts after that.',
  'refusal.missingPrerequisite': 'missing prerequisites: {missing}',
  'refusal.exitConfirmRequired': 'A Run is in flight: confirm once more to exit.',

  'prerequisite.envFile': 'the .env file',

  'defect.emptyFiles': 'files downloaded empty: {files}',
  'defect.persistentFailures': '{count} wallpapers kept failing to download',
  'defect.emptyResult': 'no wallpapers were found',
  'defect.mirrorGapMissing': '{count} listed wallpapers are not downloaded yet',
} satisfies Record<MessageKey, string>

/**
 * The refusal code → message key map (#47). `Record<RefusalCode, MessageKey>`
 * is what makes a code without copy a `tsc` error; the dictionary test walks
 * the contract's own tuples and checks the other half — that each key resolves
 * to written-out text in both locales.
 */
export const REFUSAL_MESSAGE_KEYS: Record<RefusalCode, MessageKey> = {
  'run-busy': 'refusal.runBusy',
  'orphaned-run': 'refusal.orphanedRun',
  'missing-prerequisite': 'refusal.missingPrerequisite',
  'exit-confirm-required': 'refusal.exitConfirmRequired',
}

/** The prerequisite code → message key map (#47), same guarantee as above. */
export const PREREQUISITE_MESSAGE_KEYS: Record<PrerequisiteCode, MessageKey> = {
  'env-file': 'prerequisite.envFile',
}

/**
 * The verdict → message key map. `clean | explained | defect` is already a code
 * the service ships untouched; the reader's word for it is the page's
 * (docs/adr/0014).
 */
export const VERDICT_MESSAGE_KEYS: Record<ConsoleVerdict, MessageKey> = {
  clean: 'verdict.clean',
  explained: 'verdict.explained',
  defect: 'verdict.defect',
}

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
 * One piece of a message: either the message's own text, or the value a
 * parameter filled in. Keeping them apart is what lets a template give the
 * values the numeral role without putting markup in the dictionary — a
 * parameter is a value from the data (a count, an id, a file name, a code) and
 * the message's own text is prose.
 */
export interface MessagePart {
  /** The piece as written: literal text, or the parameter's value. */
  text: string
  /** The parameter this piece is the value of; `null` for the message's own text. */
  name: string | null
}

/**
 * One message, split at its parameters. A parameter the message does not name
 * is ignored, and a placeholder with no parameter is left as written — visible
 * in the page as `{count}` rather than silently dropped.
 */
export function translateParts(
  locale: Locale,
  key: MessageKey,
  params?: MessageParams,
): MessagePart[] {
  const message = dictionaries[locale][key]
  if (params === undefined) return [{ text: message, name: null }]
  const parts: MessagePart[] = []
  let end = 0
  for (const match of message.matchAll(PLACEHOLDER)) {
    const start = match.index ?? end
    const value = params[match[1]]
    if (value === undefined) continue
    if (start > end) parts.push({ text: message.slice(end, start), name: null })
    parts.push({ text: String(value), name: match[1] })
    end = start + match[0].length
  }
  if (end < message.length) parts.push({ text: message.slice(end), name: null })
  return parts
}

/**
 * One message, in one language, with its parameters filled in — the pieces of
 * `translateParts`, joined. This is what a sentence with no data cell in it
 * needs; a value that must render as a data cell goes through `Message.vue`.
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  return translateParts(locale, key, params)
    .map(part => part.text)
    .join('')
}
