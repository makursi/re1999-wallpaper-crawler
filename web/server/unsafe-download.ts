// ── Files Windows marked as unsafe (#85) ────────────────────────────
//
// A zip that came from a browser carries Mark-of-the-Web, and extracting it
// copies that mark to every file as a `:Zone.Identifier` alternate data stream.
// The symptom is never a clear error: the page opens blank, a thumbnail answers
// 500, or the program does not start at all — and every phrase the user can see
// is unrelated to the cause. A supporter's worst case.
//
// So a start checks the files it is about to run and says, in Chinese, which
// files carry the mark and what to do about it. The check is deliberately small
// and local: one `fs.existsSync` per named file, no scanning of a tree that can
// hold thousands of assets, and no attempt to remove the mark itself (that is
// the user's decision, and Windows' own command does it).
//
// `cmd.exe` cannot print this: a `.bat` with Chinese text is at the mercy of the
// console's code page, and a UTF-8 script with a BOM breaks its first line. The
// launcher stays ASCII and the program says the words.

import * as fs from 'node:fs'

/** The stream Explorer adds to a downloaded file; the path suffix carries it. */
export const ZONE_IDENTIFIER_STREAM = 'Zone.Identifier'

/** Whether one file carries the mark. */
export function hasZoneIdentifier(file: string): boolean {
  // `file:Zone.Identifier` is a real path to the stream on Windows, and an
  // ordinary missing file name elsewhere — the same predicate on both, which is
  // why the check needs no platform branch.
  return fs.existsSync(`${file}:${ZONE_IDENTIFIER_STREAM}`)
}

/** A decision about one file, injected so a test needs no download. */
export type ZoneMarked = (file: string) => boolean

/** The files among these that carry the mark, in the order given. */
export function markedAsUnsafe(
  files: readonly string[],
  marked: ZoneMarked = hasZoneIdentifier,
): string[] {
  return files.filter(file => marked(file))
}

/**
 * The Chinese instruction for a start that found marked files, or `null` when
 * there is nothing to say.
 *
 * It is printed and the program carries on: unblocking is the user's action, and
 * refusing to start a tree that may work anyway would be a worse failure than a
 * message. The command names the program directory because that is the folder
 * the user extracted.
 */
export function unsafeDownloadNotice(marked: readonly string[], appRoot: string): string | null {
  if (marked.length === 0) return null
  return [
    'Windows 把这些程序文件标记为"来自其他计算机"（Mark-of-the-Web）。',
    '如果页面空白、缩略图加载不出来或程序启动失败，请先解除这个标记再重试：',
    '  1. 右键点击下载的压缩包 → 属性 → 勾选"解除锁定" → 确定，然后重新解压；',
    '  2. 或者右键点击解压后的文件夹 → 属性 → 勾选"解除锁定" → 确定；',
    '  3. 或者在解压后的文件夹里打开 PowerShell，运行：',
    `     Get-ChildItem "${appRoot}" -Recurse | Unblock-File`,
    '被标记的文件：',
    ...marked.map(file => `  ${file}`),
  ].join('\n')
}
