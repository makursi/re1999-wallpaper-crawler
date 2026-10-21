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

import type {
  ConsoleGalleryRowState,
  ConsoleVerdict,
  ExplainedReasonKind,
  PrerequisiteCode,
  RefusalCode,
} from '../../api-types.js'

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
  // The update notice (#81): one discreet line, one link to the project's
  // Releases page. There is no download and no mirror, so the copy names the
  // version and where to read about it — never an action the Console takes.
  'update.available': '有新版本 {version}',
  'update.releases': 'Releases 页面',
  'drawer.title': '运行面板',
  'drawer.close': '关闭(Esc)',

  // The Run panel. Every value the service used to send as prose is now a code
  // (#47); what is here is the panel's own words, and the code → message maps
  // at the bottom of this file hold each service code to its copy.
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
  // The setup notice (#60): with no usable `.env` the panel says what to create
  // before the reader clicks start. The file name is a data cell, so it travels
  // as a parameter; the line is the site's constant, not translatable prose, and
  // is the same line README.md's quick start gives. #76 removed the page path
  // with the browser crawl that needed it, so one line is all a Run requires.
  'run.setup.heading': '先完成站点配置',
  'run.setup.body': '这个控制台还没有可用的站点配置,所以暂时不能开始运行。',
  'run.setup.file': '请在仓库根目录创建 {file} 文件,写入以下一行:',
  'run.setup.lines': 'BASE_ORIGIN=https://re.bluepoch.com',
  'run.setup.note': '保存后刷新页面,提示就会消失,就可以开始运行了。',

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
    '清理是可选项,不是强制项:它可能仍是一个正在写入的运行,而仅凭日志目录分不清这两种情况。清理会撤回这条提示;运行日志本身永不修改、也不删除,因为它是这次运行的审计轨迹。',
  'orphan.clean': '清理',
  'orphan.refusedCleanup': '本地控制台拒绝清理(HTTP {status})',

  // The gallery: the official list read against the Mirror, and the three
  // states a row can be in.
  'gallery.heading': '官方清单',
  // The wall's display mark: a logotype, not a phrase, so it is the same word
  // in both locales and is translated nowhere (docs/adr/0015, story 20).
  'wall.mark': 'WALLPAPER',
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

  'prerequisite.envFile': '.env 配置文件',

  'run.explained.discoveryLeak': '发现泄漏,但全部由站点资源解释:{urls}',
  'run.explained.mirrorGapExtra': '镜像里有 {count} 个文件已不在官方清单中',

  // The Run report's defect block, as rows: the page names each class and lays
  // the values out, instead of printing the raw record.
  'defect.none': '未发现缺陷。',
  'defect.discoveryLeak': '发现泄漏:{count} 个 URL',
  'defect.nonConverged': '发现未完成:官网清单没有回答',
  'defect.emptyResult': '没有可下载的壁纸',
  'defect.persistentFailures': '持续失败:{count} 个',
  'defect.emptyFiles': '空文件:{files}',
  'defect.siteAssetNotChecked': '站点资源误报检查:未检查',
  'defect.siteAssetFalsePositive': '站点资源被误判为壁纸:{count} 个',
  'defect.gallerySourceUnavailable': '官方清单读取失败',
  'defect.mirrorGapNotChecked': '镜像缺口:未检查',
  'defect.mirrorGapMissing': '镜像缺口:官方清单中有 {count} 张壁纸不在镜像里',
  'defect.mirrorGapExtra': '镜像缺口:镜像里有 {count} 个文件已不在官方清单中',
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
  'app.wallpapersInMirror': '{count} Wallpapers in the Mirror',
  'app.mirrorAgainstTotal': '{count} Wallpapers in the Mirror against a Gallery total of {total}',

  'language.label': 'Interface language',
  'language.chinese': '中文',
  'language.english': 'English',

  'nav.mirrorCount': 'Mirror {count}',
  'nav.run': 'Run',
  'nav.version': 'version {version}',
  'update.available': 'Version {version} is available',
  'update.releases': 'Releases page',
  'drawer.title': 'Run panel',
  'drawer.close': 'Close (Esc)',

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
  'run.setup.heading': 'Set up the site first',
  'run.setup.body': 'This Console has no usable site configuration yet, so a Run cannot start.',
  'run.setup.file': 'Create the {file} file at the repository root with this line:',
  'run.setup.lines': 'BASE_ORIGIN=https://re.bluepoch.com',
  'run.setup.note': 'After saving it, refresh the page: the notice goes away and a Run can start.',

  'verdict.clean': 'clean',
  'verdict.explained': 'explained',
  'verdict.defect': 'defect',

  'orphan.line':
    'Orphaned Run {runId} — the Run log {logName} has no Run report and was written recently.',
  'orphan.newestLog': 'its newest Run log',
  'orphan.explanation':
    "Cleaning it up is offered, not forced: it may still be a Run that is writing, and the log directory alone cannot tell the two apart. The cleanup withdraws this notice; the Run log itself is never edited or deleted, because it is the Run's audit trail.",
  'orphan.clean': 'Clean up',
  'orphan.refusedCleanup': 'the Console refused the cleanup (HTTP {status})',

  'gallery.heading': 'Gallery list',
  'wall.mark': 'WALLPAPER',
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
  'viewer.zoomOut': 'Zoom out',
  'viewer.zoomIn': 'Zoom in',
  'viewer.reset': 'Reset',
  'viewer.zoomPercent': 'Zoom {percent}%',

  'refusal.runBusy':
    'A Run is already in flight: two Runs would write the same Mirror and log directory and destroy each other’s state.',
  'refusal.orphanedRun':
    'An Orphaned Run is present: its Run log has no Run report and was written recently, so it may still be writing. Clean it up from the page if it is a leftover; a new Run starts after that.',
  'refusal.missingPrerequisite': 'missing prerequisites: {missing}',

  'prerequisite.envFile': 'the .env file',

  'run.explained.discoveryLeak':
    'discovery leak, wholly accounted for by the Site asset list: {urls}',
  'run.explained.mirrorGapExtra': 'mirror gap: {count} extra files not in the gallery any more',

  'defect.none': 'No defects found.',
  'defect.discoveryLeak': 'discovery leak: {count} URLs',
  'defect.nonConverged': 'Discovery did not finish: the Gallery list did not answer',
  'defect.emptyResult': 'nothing to download',
  'defect.persistentFailures': 'persistent failures: {count}',
  'defect.emptyFiles': 'empty files: {files}',
  'defect.siteAssetNotChecked': 'Site asset false-positive check: not checked',
  'defect.siteAssetFalsePositive': 'Site assets mistaken for Wallpapers: {count}',
  'defect.gallerySourceUnavailable': 'the Gallery list could not be read',
  'defect.mirrorGapNotChecked': 'Mirror gap: not checked',
  'defect.mirrorGapMissing': 'Mirror gap: {count} listed Wallpapers missing from the Mirror',
  'defect.mirrorGapExtra': 'Mirror gap: {count} extra Mirror files not in the gallery any more',
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
}

/** The prerequisite code → message key map (#47), same guarantee as above. */
export const PREREQUISITE_MESSAGE_KEYS: Record<PrerequisiteCode, MessageKey> = {
  'env-file': 'prerequisite.envFile',
}

/** The explained reason kind → message key map (#47). */
export const EXPLAINED_REASON_MESSAGE_KEYS: Record<ExplainedReasonKind, MessageKey> = {
  'discovery-leak': 'run.explained.discoveryLeak',
  'mirror-gap-extra': 'run.explained.mirrorGapExtra',
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

/** The gallery row state → message key map, same guarantee as the others. */
export const GALLERY_ROW_STATE_MESSAGE_KEYS: Record<ConsoleGalleryRowState, MessageKey> = {
  'on-disk': 'gallery.state.onDisk',
  missing: 'gallery.state.missing',
  'not-in-gallery': 'gallery.state.notInGallery',
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
