// ── The layout of the user's data ───────────────────────────────────
//
// The user's things live in one directory that is not the program directory:
// beside the package's `app/`, or — in a source checkout — the repository's own
// `data/` (#80). Replacing the program therefore cannot touch the Mirror, the
// Run logs or the thumbnail cache, and deleting the folder is the only
// uninstall.
//
// The Data root is an injection, never a deduction from a module's position:
// `core/app-root.ts` resolves it once and every layer receives it (#78). What
// this module adds is the arrangement *inside* it:
//
//   <data>/images/            the Mirror
//   <data>/logs/              the Run log directory
//   <data>/cache/thumbnails/  the disposable thumbnail cache, outside the Mirror
//   <data>/layout.json        the data-layout version marker
//
// The marker is what makes a silent failure impossible. A newer layout version
// (a program downgraded under data it does not understand) refuses to start
// with a Chinese explanation and changes nothing — "official 1010 / local 0"
// with no message is the failure this exists to prevent.
//
// Migrating a checkout that predates #80 is by rename only, on the same volume,
// and idempotent: an interrupted migration is completed next start, and a
// target that already exists refuses rather than merges. Nothing here ever
// deletes a directory or a file: the one write a fresh start makes is the
// marker, and the one move is a rename.

import * as fs from 'node:fs'
import * as path from 'node:path'

/** The layout this program understands. A newer one is a refusal, not a guess. */
export const DATA_LAYOUT_VERSION = 1

/** The marker's name, directly under the data root. */
export const DATA_LAYOUT_FILE_NAME = 'layout.json'

export const IMAGES_DIR_NAME = 'images'
export const LOG_DIR_NAME = 'logs'
/** The disposable area's name, directly under the data root. */
export const CACHE_DIR_NAME = 'cache'
/** The thumbnail cache's directory name, under the lane's `cache/`. */
export const THUMBNAIL_CACHE_DIR_NAME = 'thumbnails'
export const GALLERY_STATE_FILE_NAME = '.gallery-state.json'

/** Where the pre-#80 checkout kept each kind of data, under its program root. */
const LEGACY_CACHE_PATH = ['web', '.console-cache'] as const

export interface DataLayoutInput {
  /** The program directory, injected by the entry point (#78). */
  appRoot: string
  /** The user's data directory, injected by the entry point (#78). */
  dataRoot: string
  /** The schema's `IMAGES_DIR`; a relative value is resolved under the data root. */
  configuredImagesDir?: string
  /** The schema's `LOG_DIR`; a relative value is resolved under the data root. */
  configuredLogDir?: string
}

/** Every path this program resolves for one data directory. */
export interface DataLayout {
  appRoot: string
  dataRoot: string
  /** `<data>/layout.json`, the version marker. */
  markerFile: string
  /** The Mirror. */
  imagesDir: string
  /** The Run log directory. */
  logDir: string
  /** `<data>/cache/thumbnails`; outside the Mirror (ADR 0010). */
  cacheDir: string
  /** `images/.gallery-state.json`; beside the Mirror it describes (ADR 0006). */
  galleryStateFile: string
}

/**
 * Resolve the arrangement inside one data directory.
 *
 * `configuredImagesDir` and `configuredLogDir` are the schema's values, so the
 * mirror path stays configurable; both are resolved against the data root, not
 * the program directory, because they are the user's data.
 */
export function dataLayoutOf(input: DataLayoutInput): DataLayout {
  const appRoot = path.resolve(input.appRoot)
  const dataRoot = path.resolve(input.dataRoot)
  const imagesDir = path.resolve(dataRoot, input.configuredImagesDir ?? IMAGES_DIR_NAME)
  return {
    appRoot,
    dataRoot,
    markerFile: path.join(dataRoot, DATA_LAYOUT_FILE_NAME),
    imagesDir,
    logDir: path.resolve(dataRoot, input.configuredLogDir ?? LOG_DIR_NAME),
    cacheDir: path.join(dataRoot, CACHE_DIR_NAME, THUMBNAIL_CACHE_DIR_NAME),
    galleryStateFile: path.join(imagesDir, GALLERY_STATE_FILE_NAME),
  }
}

// ── the version marker ──────────────────────────────────────────────

export type DataLayoutMarkerReading =
  | { kind: 'absent' }
  | { kind: 'version'; version: number }
  | { kind: 'invalid'; detail: string }

/**
 * Read the marker without assuming its shape. "Absent" is a fresh (or legacy)
 * installation; "invalid" is data this program must not guess about.
 */
export function readDataLayoutMarker(file: string): DataLayoutMarkerReading {
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

  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
    return { kind: 'invalid', detail: 'no version field' }
  }
  const { version } = parsed
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return { kind: 'invalid', detail: 'the version is not a non-negative integer' }
  }
  return { kind: 'version', version }
}

// ── refusals ────────────────────────────────────────────────────────

export type DataLayoutRefusalCode =
  | 'newer-layout'
  | 'unknown-layout'
  | 'legacy-conflict'
  | 'cross-volume'

/** A refusal to start, with the Chinese explanation the user sees. */
export interface DataLayoutRefusal {
  code: DataLayoutRefusalCode
  /** One user-facing explanation; it is what the entry point prints. */
  message: string
  /** The paths the refusal is about, for a clearer message and for tests. */
  paths: string[]
}

/** The error a Run's eager configuration throws for an unsupported layout. */
export class DataLayoutError extends Error {
  constructor(public readonly refusal: DataLayoutRefusal) {
    super(refusal.message)
    this.name = 'DataLayoutError'
  }
}

function newerLayoutRefusal(file: string, version: number): DataLayoutRefusal {
  return {
    code: 'newer-layout',
    paths: [file],
    message:
      `数据目录的布局版本是 ${version}，高于本程序支持的版本 ${DATA_LAYOUT_VERSION}。\n` +
      `标记文件：${file}\n` +
      `这通常意味着你用过更新版本的程序。请改用能识别该版本的程序启动；` +
      `本程序没有改动你的任何数据。`,
  }
}

function unknownLayoutRefusal(file: string, detail: string): DataLayoutRefusal {
  return {
    code: 'unknown-layout',
    paths: [file],
    message:
      `无法识别数据目录的布局版本（${detail}）。\n` +
      `标记文件：${file}\n` +
      `本程序不会猜测或忽略这份数据。请先备份数据目录，再用与其匹配的程序版本启动；` +
      `本程序没有改动你的任何数据。`,
  }
}

/** The refusal for a marker that exists, or `null` when it is the current version. */
function refusalOfReading(
  reading: DataLayoutMarkerReading,
  file: string,
): DataLayoutRefusal | null {
  if (reading.kind === 'absent') return null
  if (reading.kind === 'invalid') return unknownLayoutRefusal(file, reading.detail)
  if (reading.version > DATA_LAYOUT_VERSION) {
    return newerLayoutRefusal(file, reading.version)
  }
  // Lower versions are the forward-migration direction. Version 1 is the oldest
  // one this program has, so there is no supported migration below it yet;
  // a future version adds one here, and it may add or rewrite state — never
  // delete.
  if (reading.version < DATA_LAYOUT_VERSION) {
    return unknownLayoutRefusal(file, `unsupported older version ${reading.version}`)
  }
  return null
}

/**
 * Whether the data marker at `file` forbids this program from starting.
 * Read-only: a refusal here has not written, created or moved anything.
 */
export function layoutRefusalOf(file: string): DataLayoutRefusal | null {
  return refusalOfReading(readDataLayoutMarker(file), file)
}

// ── the legacy checkout's layout ────────────────────────────────────

export type LegacyKind = 'images' | 'logs' | 'cache'

/** One directory the pre-#80 checkout kept in the program directory. */
export interface LegacyMove {
  kind: LegacyKind
  source: string
  target: string
}

/**
 * The three legacy directories and where they now belong. A configured mirror
 * or log path is the legacy source too, so a checkout that used `IMAGES_DIR=mirror`
 * is recognised rather than stranded. A source equal to its target is not a
 * legacy location at all and is left out.
 */
function legacyMovesOf(
  layout: DataLayout,
  configuredImagesDir: string | undefined,
  configuredLogDir: string | undefined,
): LegacyMove[] {
  const candidates: LegacyMove[] = [
    {
      kind: 'images',
      source: path.resolve(layout.appRoot, configuredImagesDir ?? IMAGES_DIR_NAME),
      target: layout.imagesDir,
    },
    {
      kind: 'logs',
      source: path.resolve(layout.appRoot, configuredLogDir ?? LOG_DIR_NAME),
      target: layout.logDir,
    },
    {
      kind: 'cache',
      source: path.join(layout.appRoot, ...LEGACY_CACHE_PATH),
      // The legacy cache is the whole `.console-cache/` directory, whose
      // `thumbnails/` child is the new `<data>/cache/thumbnails/`.
      target: path.dirname(layout.cacheDir),
    },
  ]
  return candidates.filter(move => path.resolve(move.source) !== path.resolve(move.target))
}

function conflictRefusal(
  moves: LegacyMove[],
  sources: string[],
  targets: string[],
): DataLayoutRefusal {
  return {
    code: 'legacy-conflict',
    paths: [...sources, ...targets],
    message:
      '检测到旧数据和新位置同时存在，无法安全搬迁：\n' +
      sources.map((source, index) => `  旧：${source}\n  新：${targets[index]}`).join('\n') +
      '\n本程序不会覆盖或删除任何一方。请手动比较这些目录，把旧目录的内容合并进新目录，' +
      '再把旧目录移走后重新启动；本程序没有改动你的任何数据。',
  }
}

function crossVolumeRefusal(moves: LegacyMove[]): DataLayoutRefusal {
  return {
    code: 'cross-volume',
    paths: moves.flatMap(move => [move.source, move.target]),
    message:
      '旧数据和新数据目录不在同一个磁盘，目录重命名无法跨磁盘完成：\n' +
      moves.map(move => `  ${move.source}\n    → ${move.target}`).join('\n') +
      '\n本程序不会复制、覆盖或删除你的数据。请手动把上面的旧目录移动到对应的新位置，' +
      '确认文件完整后再重新启动；本程序没有改动你的任何数据。',
  }
}

function crossVolumeDetail(moves: LegacyMove[], detail: string): DataLayoutRefusal {
  const refusal = crossVolumeRefusal(moves)
  return { ...refusal, message: `${refusal.message}\n（${detail}）` }
}

// ── the same-volume question ────────────────────────────────────────

/** The volume a path is on, or `null` when no ancestor could be inspected. */
function deviceOf(target: string): number | null {
  let current = path.resolve(target)
  for (;;) {
    try {
      return fs.statSync(current).dev
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
}

/**
 * Whether two paths are on the same volume. A directory rename is only lossless
 * (and instant) within one volume, so this is the decision that precedes it.
 * If a device id cannot be read the rename is attempted and an `EXDEV` still
 * becomes the same refusal — never a silent copy.
 */
function defaultSameVolume(source: string, dataRoot: string): boolean {
  const sourceDevice = deviceOf(source)
  const dataDevice = deviceOf(dataRoot)
  return sourceDevice === null || dataDevice === null ? true : sourceDevice === dataDevice
}

// ── ensuring the layout ─────────────────────────────────────────────

export interface EnsureDataLayoutOptions extends DataLayoutInput {
  /** Injected by tests; the real answer compares volume ids. */
  sameVolume?: (source: string, dataRoot: string) => boolean
}

export interface DataLayoutReady {
  layout: DataLayout
  /** The legacy directories this start moved, in the order they were moved. */
  migrated: LegacyMove[]
  /** Whether this start wrote the version marker (a fresh or migrated layout). */
  markerWritten: boolean
}

export type EnsureDataLayoutResult =
  | { ok: true; ready: DataLayoutReady }
  | { ok: false; refusal: DataLayoutRefusal }

function writeMarker(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ version: DATA_LAYOUT_VERSION }, null, 2)}\n`, 'utf8')
}

/** Whether an unknown thrown value is a Node error with this `code`. */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function isCrossDevice(error: unknown): boolean {
  return hasErrorCode(error, 'EXDEV')
}

/**
 * Bring one data directory to the current layout, or refuse.
 *
 * The marker is read first: an unsupported version is refused before any mkdir,
 * write or rename. With no marker, the only paths this may create are the data
 * root and the moved directories' parents; the only move is `fs.renameSync`.
 * A second call after a successful one performs no file operation at all, which
 * is what makes an interrupted migration safe to retry.
 */
export function ensureDataLayout(options: EnsureDataLayoutOptions): EnsureDataLayoutResult {
  const layout = dataLayoutOf(options)
  const reading = readDataLayoutMarker(layout.markerFile)
  if (reading.kind !== 'absent') {
    const refusal = refusalOfReading(reading, layout.markerFile)
    if (refusal !== null) return { ok: false, refusal }
    return { ok: true, ready: { layout, migrated: [], markerWritten: false } }
  }

  const legacy = legacyMovesOf(
    layout,
    options.configuredImagesDir,
    options.configuredLogDir,
  ).filter(move => fs.existsSync(move.source))

  if (legacy.length > 0) {
    const notDirectories = legacy.filter(move => !fs.statSync(move.source).isDirectory())
    const occupiedTargets = legacy.filter(move => fs.existsSync(move.target))
    if (notDirectories.length > 0 || occupiedTargets.length > 0) {
      const conflicts = [...notDirectories, ...occupiedTargets]
      return {
        ok: false,
        refusal: conflictRefusal(
          conflicts,
          conflicts.map(move => move.source),
          conflicts.map(move => move.target),
        ),
      }
    }

    const sameVolume = options.sameVolume ?? defaultSameVolume
    const acrossVolumes = legacy.filter(move => !sameVolume(move.source, layout.dataRoot))
    if (acrossVolumes.length > 0) return { ok: false, refusal: crossVolumeRefusal(acrossVolumes) }

    const migrated: LegacyMove[] = []
    try {
      for (const move of legacy) {
        fs.mkdirSync(path.dirname(move.target), { recursive: true })
        fs.renameSync(move.source, move.target)
        migrated.push(move)
      }
    } catch (error) {
      if (isCrossDevice(error)) {
        return { ok: false, refusal: crossVolumeDetail(legacy, 'renaming across disks failed') }
      }
      throw error
    }

    writeMarker(layout.markerFile)
    return { ok: true, ready: { layout, migrated, markerWritten: true } }
  }

  fs.mkdirSync(layout.dataRoot, { recursive: true })
  writeMarker(layout.markerFile)
  return { ok: true, ready: { layout, migrated: [], markerWritten: true } }
}
