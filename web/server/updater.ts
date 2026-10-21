// ── The updater: one folder swapped, the user's data untouched (#87) ─
//
// The user extracts the new zip somewhere and double-clicks its `更新.bat`. The
// launcher does nothing but hand this module a package root (the folder the new
// zip was extracted to) and an optional target; everything else is here, in the
// built program, because a `.bat` cannot be tested and cannot print Chinese.
//
// What it must be trusted with is narrow, and the narrowness is the design:
//
//   - **The installation is found, not assumed.** Every start records
//     `<install>` in `%LOCALAPPDATA%\re1999-wallpaper-crawler\install.json`
//     (`installation.ts`, #85). The folder may have been renamed or moved since,
//     and the pointer is rewritten on each launch, so the pointer is the last
//     known address. A user who dragged the old launcher onto the new updater
//     gives the address directly, which is what every refusal tells them to do.
//   - **`data\` is never a participant.** It is not renamed, moved, copied,
//     deleted or opened; the flow only ever names `<install>\app` and
//     `<install>\app.old`. `programTreePath` is the one function that turns a
//     name into a path, and it refuses every name but those two — a guard, not
//     a convention, because this is the only destructive module in the program.
//   - **One generation of fallback.** The previous `app.old` is removed before
//     the current `app` becomes the new `app.old`, so an installation carries
//     one fallback and never a pile.
//   - **A failed swap puts the old program back.** The rename is the point of no
//     return and it is the second-to-last step; anything that fails after it is
//     rolled back, and a rollback that itself fails says exactly where the old
//     program is instead of claiming success.
//   - **No automatic rollback across runs.** A version that runs fine is never
//     silently downgraded by a later failure (spec, "更新器"): the fallback is a
//     directory the user can rename back deliberately, and nothing reads it on
//     its own.
//   - **A running service is a refusal, not a risk.** Windows lets a running
//     image be renamed but not deleted, so half an update is possible exactly
//     where the old window is still open. The instance record (#82) says whether
//     one is; the user closes the window (the stop control, ADR 0016) and tries
//     again.
//
// Why a copy rather than a rename of the new `app\`: the user's download folder
// and their installation are often on different volumes, and a rename across
// volumes fails; and leaving the extracted package intact costs nothing. The
// running executable is safe either way — its image is loaded from disk and the
// copy reads it (Windows forbids deleting a running image, not reading it).

import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

import { installPointerFile, readInstallPointer } from './installation.js'
import { runningInstanceUrl } from './instance-handshake.js'

/** The one directory an update replaces, relative to the installation root. */
export const PROGRAM_DIR_NAME = 'app'

/** The one directory an update keeps as the previous generation. */
export const PREVIOUS_PROGRAM_DIR_NAME = 'app.old'

/**
 * The only directory names the updater may resolve inside an installation, and
 * therefore the only paths it may remove trees at.
 */
export const UPDATER_TREE_NAMES: readonly string[] = [PROGRAM_DIR_NAME, PREVIOUS_PROGRAM_DIR_NAME]

/** The files a complete package's `app\` carries; a package missing one is refused. */
export const REQUIRED_PACKAGE_FILES: readonly string[] = [
  'server.js',
  'run.js',
  'update.js',
  'node.exe',
  'web/dist/index.html',
]

/** Why the updater refused, for a caller that has to tell the cases apart. */
export type UpdateRefusalCode =
  /** No usable pointer and no argument: there is nothing to update. */
  | 'no-installation'
  /** The pointer names a folder that is no longer there. */
  | 'stale-pointer'
  /** An argument names a path that is no longer there. */
  | 'missing-target'
  /** The folder exists but is not an installation (no `app\` or no `data\`). */
  | 'not-an-installation'
  /** The new package is the installation itself, or overlaps its `app\`. */
  | 'same-root'
  /** The new package lacks the files a program directory is made of. */
  | 'incomplete-package'
  /** A Console is answering from this installation; the window must close first. */
  | 'running'
  /** An operation failed; the old program is back in place (or is named). */
  | 'failed'

/** What happened, in the two shapes the entry point prints. */
export type UpdateOutcome =
  | {
      kind: 'updated'
      installRoot: string
      /** The version the replaced `app\` declared, when it declared one. */
      previousVersion: string | null
      /** The version the new `app\` declares, when it declares one. */
      installedVersion: string | null
    }
  | {
      kind: 'refused'
      code: UpdateRefusalCode
      /** The Chinese explanation the person at the window reads. */
      message: string
    }

export interface UpdateRequest {
  /** The extracted package the updater runs from: `%~dp0`, holding the new `app\`. */
  packageRoot: string
  /** A path the user dragged onto `更新.bat`, when they gave one. */
  targetArgument?: string | null
}

export interface UpdateDeps {
  /** `%LOCALAPPDATA%`; injected so a test never reads the real pointer. */
  localAppData?: string | undefined
  /** Whether a Console answers from a data directory; the real handshake by default. */
  runningServiceUrl?: (dataRoot: string) => Promise<string | null>
  /**
   * The copy of the new `app\` into the installation. Injected only so a copy
   * that dies halfway — the one failure a single-volume test cannot provoke for
   * real — can be proven to roll back; everything the assertion then reads is
   * the real filesystem.
   */
  copyTree?: (source: string, target: string) => void
}

/** The one sentence every "where is it?" refusal ends with. */
const DRAG_INSTRUCTION =
  '请把旧安装文件夹里的 启动.bat 拖到 更新.bat 上再试一次(拖整个文件夹也可以)。'

function refusal(code: UpdateRefusalCode, message: string): UpdateOutcome {
  return { kind: 'refused', code, message }
}

/** `<installRoot>\<name>` for the two names the updater owns, or a thrown error. */
export function programTreePath(installRoot: string, name: string): string {
  if (!UPDATER_TREE_NAMES.includes(name)) {
    throw new Error(`updater: ${name} is not a directory an update may touch`)
  }
  const root = path.resolve(installRoot)
  const target = path.resolve(root, name)
  if (path.dirname(target) !== root || path.basename(target) !== name) {
    throw new Error(`updater: ${name} does not resolve to a directory inside ${root}`)
  }
  return target
}

/** Whether a path is the directory itself or somewhere under it. */
function isInside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Whether two paths name the same place, case-insensitively on Windows. */
function isSamePath(left: string, right: string): boolean {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

/** The version an `app\` declares in its `package.json`, when it declares one. */
function versionOf(appDir: string): string | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) return null
    const { version } = parsed
    return typeof version === 'string' && version.trim().length > 0 ? version.trim() : null
  } catch {
    return null
  }
}

/**
 * The installation folder a dragged path names.
 *
 * A user drags what they can see, which is anything: the old `启动.bat`, the
 * installation folder itself, or its `app\`. All three name one installation,
 * and the shapes that do not (a file anywhere else, a folder with another name)
 * are validated as an installation afterwards rather than guessed at here.
 */
export function installRootFromArgument(argument: string): string {
  const resolved = path.resolve(argument)
  let root = resolved
  try {
    if (fs.statSync(resolved).isFile()) root = path.dirname(resolved)
  } catch {
    // A path that is not there keeps its own name; the flow says so with the
    // reason that fits how it was found.
  }
  return path.basename(root) === PROGRAM_DIR_NAME ? path.dirname(root) : root
}

/** Where the installation to update is, and how the flow learned it. */
interface InstallationTarget {
  root: string
  source: 'pointer' | 'argument'
}

type TargetResolution = { target: InstallationTarget } | { refusal: UpdateOutcome }

/** The installation: the argument when there is one, the pointer otherwise. */
function installationTarget(
  request: UpdateRequest,
  localAppData: string | undefined,
): TargetResolution {
  const argument = request.targetArgument?.trim() ?? ''
  if (argument.length > 0) {
    return { target: { root: installRootFromArgument(argument), source: 'argument' } }
  }

  const file = installPointerFile(localAppData ?? process.env.LOCALAPPDATA)
  if (file === null) return { refusal: refusal('no-installation', NO_INSTALLATION_MESSAGE) }

  const reading = readInstallPointer(file)
  if (reading.kind === 'absent') {
    return { refusal: refusal('no-installation', NO_INSTALLATION_MESSAGE) }
  }
  if (reading.kind === 'invalid') {
    return {
      refusal: refusal(
        'no-installation',
        `安装位置记录读不懂(${reading.detail}):\n  ${file}\n${DRAG_INSTRUCTION}`,
      ),
    }
  }
  return { target: { root: reading.pointer.installRoot, source: 'pointer' } }
}

const NO_INSTALLATION_MESSAGE = `没有找到上次安装的位置。\n${DRAG_INSTRUCTION}`

/** What to say when the installation itself is not usable. */
function installationProblem(target: InstallationTarget): UpdateOutcome | null {
  const { root, source } = target
  if (!isDirectory(root)) {
    const message =
      source === 'pointer'
        ? `上次记录的安装位置已经不在了:\n  ${root}\n如果文件夹被改名或搬到了别处,${DRAG_INSTRUCTION}`
        : `这个位置不存在:\n  ${root}\n${DRAG_INSTRUCTION}`
    return refusal(source === 'pointer' ? 'stale-pointer' : 'missing-target', message)
  }

  const missing = [PROGRAM_DIR_NAME, 'data'].filter(name => !isDirectory(path.join(root, name)))
  if (missing.length === 0) return null

  return refusal(
    'not-an-installation',
    [
      `${root} 不是安装文件夹:缺少 ${missing.map(name => `${name}\\`).join('、')}`,
      '它应当是同时包含 app\\ 和 data\\ 的那个文件夹,也就是 启动.bat 所在的位置。',
      '如果这是刚解压、还没启动过的程序,请先双击一次 启动.bat,再回来更新。',
      DRAG_INSTRUCTION,
    ].join('\n'),
  )
}

/** Why the downloaded package cannot be the new program. */
function packageProblem(newApp: string): UpdateOutcome | null {
  if (!isDirectory(newApp)) {
    return refusal(
      'incomplete-package',
      [
        `这个更新包里没有 app\\ 目录:\n  ${newApp}`,
        '请重新下载并完整解压新版本的压缩包,再双击它的 更新.bat。',
      ].join('\n'),
    )
  }

  const missing = REQUIRED_PACKAGE_FILES.filter(name => !fs.existsSync(path.join(newApp, name)))
  if (missing.length === 0) return null

  return refusal(
    'incomplete-package',
    [
      '这个更新包不完整:app\\ 里缺少',
      ...missing.map(name => `  ${name}`),
      '请重新下载并完整解压新版本的压缩包,再双击它的 更新.bat。',
    ].join('\n'),
  )
}

/** The copy the updater makes; injected only so its failure can be tested. */
function defaultCopyTree(source: string, target: string): void {
  fs.cpSync(source, target, { recursive: true })
}

/** A caught value as one line, for the failure message. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Put the old program back after a failed copy, and say what actually happened.
 *
 * The partial new `app\` has to go before the fallback can be renamed back over
 * it, and that removal is why `programTreePath` exists: it is the exact
 * `<install>\app`, never a sibling and never the data directory.
 */
function restorePreviousProgram(
  installRoot: string,
  appDir: string,
  fallbackApp: string,
  cause: unknown,
): UpdateOutcome {
  try {
    fs.rmSync(appDir, { recursive: true, force: true })
  } catch {
    // The rename below will fail with the same cause; reporting the manual step
    // is more useful than two stacked error messages.
  }

  try {
    fs.renameSync(fallbackApp, appDir)
  } catch (rollbackError) {
    return refusal(
      'failed',
      [
        '更新失败,而且没能自动恢复原来的程序:',
        `  ${reasonOf(cause)}`,
        `  回滚失败:${reasonOf(rollbackError)}`,
        `旧的程序完整地保存在:\n  ${fallbackApp}`,
        `请关闭本窗口,然后把 ${fallbackApp} 改名为 ${path.join(installRoot, PROGRAM_DIR_NAME)}。`,
        'data\\ 目录自始至终没有被改动。',
      ].join('\n'),
    )
  }

  return refusal(
    'failed',
    [
      '更新失败,已经恢复原来的程序:',
      `  ${reasonOf(cause)}`,
      'data\\ 目录自始至终没有被改动,可以再下载一次新版本重试。',
    ].join('\n'),
  )
}

/**
 * Replace an installation's program directory, and leave everything else alone.
 *
 * Never throws: every failure is an outcome the entry point can print and exit
 * on, because a stack trace in a window the user double-clicked is a support
 * case, not an error message.
 */
export async function updateInstallation(
  request: UpdateRequest,
  deps: UpdateDeps = {},
): Promise<UpdateOutcome> {
  const resolution = installationTarget(request, deps.localAppData)
  if ('refusal' in resolution) return resolution.refusal

  const { root, source } = resolution.target
  const installRoot = path.resolve(root)
  const packageRoot = path.resolve(request.packageRoot)
  const newApp = path.join(packageRoot, PROGRAM_DIR_NAME)
  const appDir = programTreePath(installRoot, PROGRAM_DIR_NAME)
  const fallbackApp = programTreePath(installRoot, PREVIOUS_PROGRAM_DIR_NAME)

  // The package must not be the thing it would replace: the user who extracted
  // the new zip into the old folder has one `app\`, not two, and swapping it
  // with itself would destroy both the program and the fallback.
  if (
    isSamePath(packageRoot, installRoot) ||
    isInside(newApp, appDir) ||
    isInside(appDir, newApp)
  ) {
    return refusal(
      'same-root',
      [
        '更新器就在要更新的那个安装文件夹里,没有第二个 app\\ 可以换进去。',
        '请把新下载的压缩包解压到别的位置(例如下载文件夹),再双击那里的 更新.bat。',
      ].join('\n'),
    )
  }
  const installProblem = installationProblem({ root: installRoot, source })
  if (installProblem !== null) return installProblem

  const packageProblemFound = packageProblem(newApp)
  if (packageProblemFound !== null) return packageProblemFound

  // A Console holding this installation open is the one thing that turns a
  // clean swap into a half-updated tree (Windows permits renaming a running
  // image, not deleting it). The record is the program's own handshake, so the
  // question is the same one a second double-click asks (#82).
  const runningUrl = await (deps.runningServiceUrl ?? runningInstanceUrl)(
    path.join(installRoot, 'data'),
  )
  if (runningUrl !== null) {
    return refusal(
      'running',
      [
        `程序正在运行:\n  ${runningUrl}`,
        '请先关闭它的窗口(关闭窗口就是停止),再双击 更新.bat。',
        '放着不管直接更新,会留下一个新旧混合的程序目录。',
      ].join('\n'),
    )
  }

  const previousVersion = versionOf(appDir)
  const installedVersion = versionOf(newApp)

  // The fallback is replaced before it is created, so one installation keeps one
  // generation of `app.old\` — and this is the only delete that is not the
  // partial copy below.
  try {
    fs.rmSync(fallbackApp, { recursive: true, force: true })
  } catch (error) {
    return refusal(
      'failed',
      [
        '更新没有开始:无法清理上一代备份 app.old\\',
        `  ${reasonOf(error)}`,
        '程序目录没有被改动。请关闭可能正在使用 app.old\\ 的程序后重试。',
      ].join('\n'),
    )
  }

  try {
    fs.renameSync(appDir, fallbackApp)
  } catch (error) {
    return refusal(
      'failed',
      [
        '更新没有开始:无法把 app\\ 改名为 app.old\\',
        `  ${reasonOf(error)}`,
        '程序目录没有被改动,data\\ 也没有。',
      ].join('\n'),
    )
  }

  try {
    ;(deps.copyTree ?? defaultCopyTree)(newApp, appDir)
  } catch (error) {
    return restorePreviousProgram(installRoot, appDir, fallbackApp, error)
  }

  return { kind: 'updated', installRoot, previousVersion, installedVersion }
}
