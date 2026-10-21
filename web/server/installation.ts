// ── Where this program is installed (#85) ───────────────────────────
//
// A portable program has no installer to remember where it lives, and its
// folder can be renamed or moved after the user unzipped it. The updater (#87)
// still has to find the extraction the user is actually running, so every start
// records the installation root in one pointer file under `%LOCALAPPDATA%`, and
// the updater reads that.
//
// The pointer is written on every start rather than only the first: moving the
// folder is a normal thing to do, and the next launch is the moment the program
// learns the new address. It is rewritten atomically enough for its purpose (one
// small JSON file whose reader tolerates an unreadable value).
//
// **Only the portable package has an installation to point at.** The package is
// `<install>\app` (the program) beside `<install>\data` (the user's things), so
// `installRootOf` recognises that exact pair and nothing else. A source checkout
// keeps its data at `<repo>\data`, where `<repo>` is the program root — there is
// no folder an updater would replace, so no pointer is written and `pnpm webui`
// never touches AppData.

import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

/** The directory under `%LOCALAPPDATA%` this program owns. */
export const INSTALL_POINTER_DIR_NAME = 're1999-wallpaper-crawler'

/** The pointer's file name, inside that directory. */
export const INSTALL_POINTER_FILE_NAME = 'install.json'

/** The pointer's shape version; a newer one is not guessed at. */
export const INSTALL_POINTER_VERSION = 1

export interface InstallPointer {
  version: number
  /** The folder the user unzipped: the parent of both `app\` and `data\`. */
  installRoot: string
  /** When this pointer was last confirmed by a real launch. */
  updatedAt: string
}

/**
 * The package's installation root for an app/data pair, or `null` when the pair
 * is not the portable package's shape.
 *
 * The rule is the package's own layout (#75, #86), stated once: the program is
 * `<install>\app`, its data is `<install>\data`, and they are siblings. A source
 * checkout (`<repo>` + `<repo>\data`) and a misconfigured pair both answer
 * `null`, because an updater pointed at either would replace the wrong folder.
 */
export function installRootOf(appRoot: string, dataRoot: string): string | null {
  const programDir = path.resolve(appRoot)
  const dataDir = path.resolve(dataRoot)
  if (path.basename(programDir) !== 'app' || path.basename(dataDir) !== 'data') return null

  const installRoot = path.dirname(programDir)
  return path.dirname(dataDir) === installRoot ? installRoot : null
}

/**
 * `%LOCALAPPDATA%\re1999-wallpaper-crawler\install.json`, or `null` when the
 * environment has no `LOCALAPPDATA` (a non-Windows machine, a stripped
 * environment). Nothing is written without a place to write it.
 */
export function installPointerFile(localAppData: string | undefined): string | null {
  const base = localAppData?.trim()
  if (base === undefined || base.length === 0) return null
  return path.join(path.resolve(base), INSTALL_POINTER_DIR_NAME, INSTALL_POINTER_FILE_NAME)
}

export type InstallPointerReading =
  | { kind: 'absent' }
  | { kind: 'invalid'; detail: string }
  | { kind: 'pointer'; pointer: InstallPointer }

/**
 * Read a pointer without assuming its shape, for the updater (#87) and for the
 * start that wants to say whether it rewrote one. `absent` and `invalid` are
 * both "no usable installation record"; neither throws.
 */
export function readInstallPointer(file: string): InstallPointerReading {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    return hasErrorCode(error, 'ENOENT')
      ? { kind: 'absent' }
      : { kind: 'invalid', detail: 'the file could not be read' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'invalid', detail: 'not JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'invalid', detail: 'not an object' }
  }
  if (!('version' in parsed) || !('installRoot' in parsed) || !('updatedAt' in parsed)) {
    return { kind: 'invalid', detail: 'a field is missing' }
  }

  const { version, installRoot, updatedAt } = parsed
  if (version !== INSTALL_POINTER_VERSION) {
    return { kind: 'invalid', detail: `shape version ${String(version)} is not known` }
  }
  if (typeof installRoot !== 'string' || installRoot.trim() === '') {
    return { kind: 'invalid', detail: 'the install root is not a non-empty string' }
  }
  if (typeof updatedAt !== 'string' || updatedAt.trim() === '') {
    return { kind: 'invalid', detail: 'the timestamp is not a non-empty string' }
  }
  return { kind: 'pointer', pointer: { version, installRoot, updatedAt } }
}

export interface InstallPointerOptions {
  /** The installation root this launch confirmed. */
  installRoot: string
  /** `%LOCALAPPDATA%`; the environment's by default. */
  localAppData?: string
  /** Injected so a test pins the timestamp. */
  now?: Date
}

export type InstallPointerResult =
  | { written: true; file: string }
  | { written: false; reason: 'no-local-app-data' | 'unwritable' }

/**
 * Record this installation, and say whether it did.
 *
 * Never fatal: a machine that refuses the write still has a working program, and
 * the caller says so once rather than failing a start over the updater's memory.
 */
export function writeInstallPointer(options: InstallPointerOptions): InstallPointerResult {
  const file = installPointerFile(options.localAppData ?? process.env.LOCALAPPDATA)
  if (file === null) return { written: false, reason: 'no-local-app-data' }

  const pointer: InstallPointer = {
    version: INSTALL_POINTER_VERSION,
    installRoot: path.resolve(options.installRoot),
    updatedAt: (options.now ?? new Date()).toISOString(),
  }

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8')
  } catch {
    return { written: false, reason: 'unwritable' }
  }
  return { written: true, file }
}

/** Whether an unknown thrown value is a Node error with this `code`. */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
