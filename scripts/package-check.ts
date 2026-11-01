#!/usr/bin/env node
// ── The release check: install and boot the real archive (#120) ─────
//
// `pnpm package` produces one zip whose extracted root IS the program root
// (#118). Every other check in this repository starts from `build/` or from
// sources; none of them ever runs the archive, and the thing a maintainer
// publishes is the archive. This command is that gap closed, in the release's
// own order:
//
//   解压   extract the zip                 into a directory outside the repository
//   安装   `npm install --omit=dev …`      resolves sharp from the registry
//   启动   `npm start`                     the manifest's own script, in that root
//   探活   `GET /api/status`               the printed token and the declared version
//   退出   `POST /api/exit`                202, and the process ends with code 0
//
// Every failure names the step and exits non-zero; every success prints an
// `ok - ` line as it happens, so a CI log says how far the chain got
// (`scripts/smoke-boot.ts` prints the same shape for the boot check).
//
// **What this covers, and only this.** The archive's own `package.json` (the
// shipped manifest: `npm start`, the Node floor, `sharp` as its only dependency),
// the `package-lock.json` generated against it, `.npmrc`'s `engine-strict` (the
// install runs in a root npm reads that file from and accepts the running Node),
// the two entries and the page booting from the archive's own files, and one
// thumbnail-sized proof that `sharp` — the one native module — loads and produces
// bytes. That last assertion is the one the old Windows portable package could
// only prove on a maintainer's machine: the module is resolved here from the
// registry, not shipped.
//
// **It needs the network, which is exactly why it is release-only.** `npm
// install` resolves sharp from the registry, so this command cannot run in the
// per-PR gate and is not wired into CI (#122 owns the release workflow). It also
// cannot cover a *player's* clean machine, an offline or mirrored install, or the
// first real crawl — the 2 GB and 10–40 minutes of actual wallpapers are a
// different run. What it does cover is the delivery chain between the zip and a
// serving page.
//
// **It never touches the repository.** The extraction root, npm's working
// directory and the data directory the boot creates all live inside one
// `mkdtemp` directory, which is removed on the way out; the repository's own
// `.env` and `data/` are never read or written. The archive's `.env` is the one
// the packager generated from `packaging/site.env`, and that is what makes the
// check independent of the developer's checkout: whatever an owner has in their
// working tree cannot decide whether the release works. The boot's environment
// is cleared of `RE1999_*` and of the site-configuration keys for the same
// reason, and `BASE_ORIGIN` is pointed at a closed loopback port: the game's
// list is not part of the delivery chain, and a site outage must not fail a
// packaging check. The status read therefore answers with "the list was not
// read", which is a valid status — the probe is about the guard, the version and
// the page booting.
//
// **The boot is driven only through the page's own API**, with the token the
// boot prints in its address (`WebUI: http://127.0.0.1:<port>/?token=…`) — the
// same rule `scripts/smoke-boot.ts` follows. A probe that bypassed the guard
// would prove the wrong thing. On any failure the process is stopped with its
// children (`taskkill /T` on Windows, the process group elsewhere), so a failed
// check leaves no server holding a port.
//
// **Two Windows facts are load-bearing.** `npm` is `npm.cmd`, which Node refuses
// to spawn without `shell: true`; and a long install's own output belongs on the
// terminal (`stdio: 'inherit'`), not in a buffer this script would only print on
// failure. The install is the one step whose output is inherited; the boot's
// output has to be captured, because the address and the token are in it.
//
// Usage: `pnpm package:check [archive.zip]`. Without an argument it takes the
// newest `dist-package/re1999-wallpaper-crawler-v*.zip`, or the path this
// checkout's `package.json` version names. No archive is a failure that says so
// — never a crash.

import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

import { DATA_LAYOUT_FILE_NAME } from '../core/data-layout.js'
import type { ConsoleStatusPayload } from '../web/api-types.js'
import { packageVersion } from './package-version.js'
import { extractZip } from './unzip.js'

/** The repository root: this script's parent. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..')

/** Where `pnpm package` writes the release. */
const DIST_PACKAGE_DIR = path.join(REPO_ROOT, 'dist-package')

/** The archive's name prefix; the version completes it. */
const ARCHIVE_PREFIX = 're1999-wallpaper-crawler-v'

/** The one version this checkout declares; the archive has to be that release. */
const PACKAGE_FILE = path.join(REPO_ROOT, 'package.json')

/** The root entries the extracted archive must carry, as archive-relative paths. */
const REQUIRED_ARCHIVE_FILES: readonly string[] = [
  'README.md',
  'LICENSE.txt',
  'package.json',
  'package-lock.json',
  '.npmrc',
  '.env',
  'server.js',
  'run.js',
  'web/dist/index.html',
]

/** The manifest the extracted archive carries, as this check reads it. */
interface ArchiveManifest {
  /** The version the archive declares; the page must report it. */
  version: string
  /** The manifest's start script, which `npm start` runs. */
  start: string
  /** The Node floor the shipped manifest declares and `.npmrc` enforces. */
  nodeFloor: string
  /** The runtime dependencies; `sharp` is the only one allowed. */
  dependencies: string[]
}

/** The install that resolves the shipped manifest's runtime dependency. */
const INSTALL_ARGS = ['install', '--omit=dev', '--no-audit', '--no-fund'] as const

/** The install's one command, in full, for the log. */
const INSTALL_COMMAND = ['npm', ...INSTALL_ARGS].join(' ')

/**
 * The arguments the check passes to the entry through the manifest's start
 * script: an OS-assigned port and no browser. They must arrive after `--`, which
 * is what proves the start script forwards its caller's arguments.
 */
const BOOT_ARGS = ['--no-open', '--port', '0'] as const

/** The address the Console prints once it is listening. */
const BOOT_ADDRESS = /WebUI: (http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+)/

/** An install of one native dependency from the registry; generous, not infinite. */
const INSTALL_TIMEOUT_MS = 10 * 60_000

/** The native module's own smoke: it either loads in a second or it does not. */
const PROBE_TIMEOUT_MS = 60_000

/** A boot that prints no address in this long is not going to. */
const BOOT_TIMEOUT_MS = 60_000

/** An accepted exit answers on the spot and stops the process shortly after. */
const EXIT_TIMEOUT_MS = 15_000

/** One API request's budget: loopback, so this is already generous. */
const REQUEST_TIMEOUT_MS = 15_000

/** The configuration keys the boot must not inherit from the developer's shell. */
const CONFIG_ENV_KEYS = ['BASE_ORIGIN', 'IMAGES_DIR', 'LOG_DIR', 'BATCH_SIZE', 'USER_AGENT']

/**
 * A loopback address nothing listens on. The archive's `.env` names the game's
 * site, and the status read would ask it for the Gallery list; that request is
 * not part of the delivery chain, so the boot is given an origin whose connection
 * is refused at once and the list answers "not read".
 */
const OFFLINE_BASE_ORIGIN = 'http://127.0.0.1:1'

/**
 * The native module's proof, run as an ESM snippet in the extracted root so
 * `import 'sharp'` resolves from *that* `node_modules` — the install's, not this
 * repository's. It loads the addon, encodes one pixel, and prints its versions;
 * a thrown error or a non-zero exit is the install's failure, at the place the
 * old package could only test by hand.
 */
const SHARP_PROBE = `
import sharp from 'sharp'
const png = await sharp({
  create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
})
  .png()
  .toBuffer()
if (png.length === 0) throw new Error('sharp produced no bytes')
process.stdout.write(
  'sharp ' + sharp.versions.sharp + ' (libvips ' + sharp.versions.vips + '), 1x1 png, ' + png.length + ' bytes\\n',
)
`

/** The five steps a failure can name. */
type Step = '解压' | '安装' | '启动' | '探活' | '退出'

/** A check that failed: the step says where the chain stopped. */
class CheckFailure extends Error {
  readonly step: Step

  constructor(step: Step, message: string, detail = '') {
    super(detail.trim() === '' ? message : `${message}\n${indent(detail)}`)
    this.step = step
  }
}

/** A precondition failure that is not one of the five steps (no archive, usage). */
class UsageFailure extends Error {}

/** One extracted archive, as the check needs it. */
interface Extracted {
  /** The extracted root, which is the program root. */
  programRoot: string
  /** `<programRoot>/data` — where the boot must create its data, with no help. */
  dataRoot: string
  /** The version the archive declares. */
  version: string
}

/**
 * One started program. The handle owns the child, its output, the address wait,
 * the close wait and the stop, so the check never subscribes to the same process
 * twice and no server outlives the step that started it.
 */
interface Program {
  /** Everything the child has written so far, stdout and stderr together. */
  output(): string
  /** Resolve once the startup address is printed; reject on exit or timeout. */
  address(): Promise<string>
  /** Resolve with the exit code once the child closes; kill it at the limit. */
  close(timeoutMs: number): Promise<number | null>
  /** Leave nothing running, even when a check threw mid-boot. */
  stop(): Promise<void>
}

/** One started program and the address it printed. */
interface Started {
  program: Program
  /** The page's URL, with this boot's `?token=`. */
  address: string
}

/** Print one check as it passes: a CI log reads how far the chain got. */
function report(what: string): void {
  process.stdout.write(`ok - ${what}\n`)
}

/**
 * Record one check, or stop the command at the first disagreement. The detail is
 * what a failure prints under the label; a function defers building it.
 */
function assert(
  step: Step,
  condition: unknown,
  what: string,
  detail: string | (() => string) = '',
): asserts condition {
  if (condition) {
    report(what)
    return
  }
  throw new CheckFailure(step, what, typeof detail === 'function' ? detail() : detail)
}

/** Wrap a helper's ordinary failure in the step that called it. */
function atStep(step: Step, error: unknown): CheckFailure {
  if (error instanceof CheckFailure) return error
  return new CheckFailure(step, error instanceof Error ? error.message : String(error))
}

/** `6.9 MB`, for the report. */
function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** A JSON object, checked without trusting the response's shape. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The fields that identify `/api/status`, so the version can be read safely. */
function isStatusPayload(body: unknown): body is ConsoleStatusPayload {
  return isRecord(body) && 'version' in body && 'state' in body && 'runConfigAvailable' in body
}

/** The exit answer's one flag, or `null` when the body is not that contract. */
function exitingOf(body: unknown): boolean | null {
  if (!isRecord(body) || !('exiting' in body)) return null
  return typeof body.exiting === 'boolean' ? body.exiting : null
}

/** Indent a detail block under its label, so one failure stays one log entry. */
function indent(text: string): string {
  const trimmed = text.trimEnd()
  if (trimmed === '') return ''
  return trimmed
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')
}

/** What is directly under the data directory, for the check's own report. */
function dataEntries(dataRoot: string): string {
  try {
    const names = fs.readdirSync(dataRoot).toSorted()
    return names.length === 0 ? '(empty)' : names.join(', ')
  } catch {
    return '(missing)'
  }
}

/**
 * The archive to check: the argument, else the newest one this checkout packed,
 * else the path its version names.
 *
 * No argument and no archive is the local command's ordinary mistake, so it is a
 * `UsageFailure` that names the expected path — not a stack trace, and not a
 * "newest" that quietly checks last release's zip after a version bump.
 */
function archiveOf(argv: readonly string[]): string {
  if (argv.length > 1) throw new UsageFailure('usage: pnpm package:check [archive.zip]')

  const named = argv[0]?.trim() ?? ''
  if (named !== '') {
    const file = path.resolve(named)
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new UsageFailure(`no archive to check: ${file} does not exist`)
    }
    return file
  }

  const newest = newestArchive()
  if (newest !== null) return newest

  const expected = path.join(
    DIST_PACKAGE_DIR,
    `${ARCHIVE_PREFIX}${packageVersion(PACKAGE_FILE)}.zip`,
  )
  throw new UsageFailure(
    `no archive to check: ${DIST_PACKAGE_DIR} holds no ${ARCHIVE_PREFIX}*.zip and ${expected} does not exist — run pnpm package first`,
  )
}

/** The newest packed archive, or `null` when the directory holds none. */
function newestArchive(): string | null {
  let names: string[]
  try {
    names = fs.readdirSync(DIST_PACKAGE_DIR)
  } catch {
    return null
  }

  const archives = names
    .filter(name => name.startsWith(ARCHIVE_PREFIX) && name.endsWith('.zip'))
    .map(name => path.join(DIST_PACKAGE_DIR, name))
    .filter(file => fs.statSync(file).isFile())
    .toSorted((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)

  return archives[0] ?? null
}

/** The extracted manifest's fields, read as values rather than cast. */
function manifestOf(programRoot: string, declaredVersion: string): ArchiveManifest {
  const file = path.join(programRoot, 'package.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new CheckFailure(
      '解压',
      `the archive's package.json is not JSON (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  if (!isRecord(parsed))
    throw new CheckFailure('解压', "the archive's package.json is not an object")

  const { version, scripts, engines, dependencies } = parsed
  assert(
    '解压',
    typeof version === 'string' && version.trim() === declaredVersion,
    `the archive declares this checkout's version (${declaredVersion})`,
    () => `declared: ${String(version)}; package.json: ${declaredVersion}`,
  )
  const start = isRecord(scripts) ? scripts.start : undefined
  assert(
    '解压',
    typeof start === 'string' && start.trim() !== '',
    `the archive's manifest declares its start script ("${String(start)}")`,
  )
  assert(
    '解压',
    isRecord(engines) && typeof engines.node === 'string' && engines.node.trim() !== '',
    "the archive's manifest declares the Node floor",
  )
  assert(
    '解压',
    isRecord(dependencies) && Object.keys(dependencies).join() === 'sharp',
    "sharp is the archive's only runtime dependency",
    () => `declared: ${isRecord(dependencies) ? Object.keys(dependencies).join(', ') : '(none)'}`,
  )

  return {
    version,
    start,
    nodeFloor: engines.node,
    dependencies: Object.keys(dependencies),
  }
}

/** The 解压 step: unpack the archive outside the repository and read its manifest. */
function extractStage(archive: string, programRoot: string, declaredVersion: string): Extracted {
  let extracted
  try {
    extracted = extractZip(archive, programRoot)
  } catch (error) {
    throw atStep('解压', error)
  }
  report(`extracted ${extracted.entries} files (${megabytes(extracted.bytes)}) from ${archive}`)

  for (const name of REQUIRED_ARCHIVE_FILES) {
    assert(
      '解压',
      fs.existsSync(path.join(programRoot, ...name.split('/'))),
      `the archive carries ${name}`,
    )
  }

  const manifest = manifestOf(programRoot, declaredVersion)
  report(
    `the archive declares node ${manifest.nodeFloor}, start "${manifest.start}", dependency ${manifest.dependencies.join(', ')}`,
  )
  return { programRoot, dataRoot: path.join(programRoot, 'data'), version: manifest.version }
}

/** `node_modules/sharp`, resolved in the extracted root: the package that must exist. */
function sharpPackage(programRoot: string): string | null {
  const file = path.join(programRoot, 'node_modules', 'sharp', 'package.json')
  return fs.existsSync(file) ? file : null
}

/** sharp's platform packages (`@img/sharp-win32-x64` …), resolved in the extracted root. */
function sharpPlatformPackages(programRoot: string): string[] {
  const directory = path.join(programRoot, 'node_modules', '@img')
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith('sharp-'))
      .map(entry => entry.name)
      .toSorted()
  } catch {
    return []
  }
}

/**
 * The 安装 step: `npm install --omit=dev` in the extracted root, then `sharp`'s
 * own load and one pixel.
 *
 * The install inherits this terminal: it is the long step, its progress is worth
 * reading, and a buffer would only be printed after the fact. On Windows npm is
 * a `.cmd`, which cannot be spawned without a shell.
 */
function installStage(programRoot: string): void {
  const result = spawnSync(INSTALL_COMMAND, {
    cwd: programRoot,
    shell: true,
    stdio: 'inherit',
    timeout: INSTALL_TIMEOUT_MS,
  })
  if (result.error !== undefined || result.status !== 0) {
    const outcome =
      result.error !== undefined
        ? `could not be started (${result.error.message})`
        : `exited ${result.status === null ? 'without a status' : String(result.status)}`
    throw new CheckFailure(
      '安装',
      `\`${INSTALL_COMMAND}\` ${outcome}`,
      [
        "The install resolves the shipped manifest's one runtime dependency from the registry.",
        'Check that the registry is reachable (and npm’s proxy/cache settings), then run the check again.',
      ].join(' '),
    )
  }
  report(`\`${INSTALL_COMMAND}\` resolved the archive's dependencies`)

  assert('安装', sharpPackage(programRoot) !== null, 'the install wrote node_modules/sharp')

  const platformPackages = sharpPlatformPackages(programRoot)
  assert(
    '安装',
    platformPackages.length > 0,
    `the install resolved sharp's platform package (${platformPackages.join(', ')})`,
    'node_modules/@img holds no sharp-* package; the native addon cannot load without one',
  )

  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', SHARP_PROBE], {
    cwd: programRoot,
    stdio: 'inherit',
    timeout: PROBE_TIMEOUT_MS,
  })
  if (probe.error !== undefined || probe.status !== 0) {
    const outcome =
      probe.error !== undefined
        ? `could not be started (${probe.error.message})`
        : `exited ${probe.status === null ? 'without a status' : String(probe.status)}`
    throw new CheckFailure(
      '安装',
      `sharp did not load in the extracted root — the probe ${outcome}`,
      'node_modules/sharp is present but its native addon did not produce a thumbnail.',
    )
  }
  report('sharp loaded its native addon in the extracted root and encoded one pixel')
}

/**
 * The boot's environment: this machine's, minus everything that could decide the
 * result for the archive — no `RE1999_*` roots, no site configuration, and the
 * site's origin pointed at a closed loopback port.
 */
function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('RE1999_')) delete env[key]
  }
  for (const key of CONFIG_ENV_KEYS) delete env[key]
  env.BASE_ORIGIN = OFFLINE_BASE_ORIGIN
  return env
}

/**
 * Stop the whole tree the start script began. `npm start` puts npm (or the shell
 * that resolved it) between this driver and the Console, so killing only the
 * direct child would leave the program holding its port. Windows kills the tree
 * with `taskkill /T`; on POSIX the child is spawned detached so its process group
 * can be signalled, with a direct kill as the fallback.
 */
function killTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined) {
    child.kill()
    return
  }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.on('error', () => child.kill())
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    child.kill()
  }
}

/**
 * Collect one spawned process into the handle the steps use. The output is
 * collected once, and the address wait, the close wait and every failure report
 * read that same buffer.
 */
function track(child: ChildProcess): Program {
  let output = ''
  let onChunk: (() => void) | null = null
  const collect = (chunk: Buffer): void => {
    output += chunk.toString('utf8')
    onChunk?.()
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  child.once('error', error => {
    output += `${error.message}\n`
    onChunk?.()
  })

  // Attached at spawn, so a process that exits before a step asks for its code
  // cannot fire `close` into the void.
  const closed = new Promise<number | null>(resolve => {
    child.once('close', code => resolve(code))
  })

  const closeWithin = (timeoutMs: number): Promise<number | null> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        killTree(child)
        reject(new CheckFailure('退出', `the program did not stop within ${timeoutMs} ms`, output))
      }, timeoutMs)
      void closed.then(code => {
        clearTimeout(timer)
        resolve(code)
        return code
      })
    })

  /** Resolve once the address is printed, riding the handle's one collector. */
  const waitForAddress = (): Promise<string> =>
    new Promise((resolve, reject) => {
      let settled = false
      const finish = (action: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        onChunk = null
        action()
      }
      const scan = (): void => {
        const match = BOOT_ADDRESS.exec(output)
        if (match !== null) finish(() => resolve(match[1]))
      }
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new CheckFailure('启动', `no boot address within ${BOOT_TIMEOUT_MS} ms`, output),
            ),
          ),
        BOOT_TIMEOUT_MS,
      )

      child.once('error', error => finish(() => reject(atStep('启动', error))))
      child.once('exit', code =>
        finish(() =>
          reject(
            new CheckFailure(
              '启动',
              `the program exited ${String(code)} before it printed an address`,
              output,
            ),
          ),
        ),
      )
      onChunk = scan
      scan()
    })

  return {
    output: () => output,
    address: waitForAddress,
    close: closeWithin,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        await closed.catch(() => null)
        return
      }
      killTree(child)
      try {
        await closeWithin(EXIT_TIMEOUT_MS)
      } catch {
        // The temporary root is about to go; a kill that did not finish is
        // reported by the check's own failure, not by a second one here.
      }
    },
  }
}

/**
 * Start the extracted root the way a user does: through the manifest's own
 * `scripts.start`, with the check's arguments after `--`.
 *
 * Windows resolves `npm` through `npm.cmd`, which Node refuses to spawn without
 * a shell; the command is the check's own fixed literals, so one command string
 * is exact. POSIX spawns npm directly and detached, so a failed check can signal
 * the whole group instead of orphaning the Console.
 */
function startShippedProgram(programRoot: string): Program {
  const startArgs = ['start', '--', ...BOOT_ARGS]
  const child =
    process.platform === 'win32'
      ? spawn(['npm', ...startArgs].join(' '), {
          cwd: programRoot,
          env: childEnvironment(),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: true,
        })
      : spawn('npm', startArgs, {
          cwd: programRoot,
          env: childEnvironment(),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          detached: true,
        })
  return track(child)
}

/**
 * The 启动 step: the extracted root has no `data/` of its own, and `npm start`
 * must create it under the root and print the address a browser would open. That
 * is the zero-argument root resolution working in the shipped shape — no
 * `RE1999_*` variable told it where the roots are — plus the start script
 * forwarding the check's flags.
 */
async function startStage(programRoot: string, dataRoot: string): Promise<Started> {
  assert('启动', !fs.existsSync(dataRoot), 'the extracted archive carries no data directory')

  const program = startShippedProgram(programRoot)
  try {
    const address = await program.address()
    const url = new URL(address)
    const token = url.searchParams.get('token') ?? ''
    report(`npm start printed ${url.origin}/?token=… (port ${url.port})`)
    assert('启动', token.length > 0, 'the printed address carries a boot token')
    return { program, address }
  } catch (error) {
    await program.stop()
    throw atStep('启动', error)
  }
}

interface Reply {
  status: number
  body: unknown
  text: string
}

/** One request to the page's own API, with the boot token still on the URL. */
async function request(address: string, route: string, init: RequestInit = {}): Promise<Reply> {
  const url = new URL(address)
  url.pathname = route
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  const text = await response.text()
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    // A non-JSON body is reported by the caller's status check; `text` carries it.
  }
  return { status: response.status, body, text }
}

/**
 * The 探活 step: `GET /api/status` with the printed token, which must answer 200
 * and report the version the archive declares — the proof that the manifest the
 * packager shipped is the program that booted. The data directory the boot
 * created under the extracted root is checked at the same moment, so the check
 * does not trust the address alone.
 */
async function probeStage(started: Started, extracted: Extracted): Promise<void> {
  let status: Reply
  try {
    status = await request(started.address, '/api/status')
  } catch (error) {
    throw new CheckFailure('探活', 'GET /api/status did not answer', String(error))
  }
  assert(
    '探活',
    status.status === 200,
    `GET /api/status answers 200 (got ${status.status})`,
    status.text,
  )
  const body = status.body
  assert('探活', isStatusPayload(body), 'GET /api/status answered a status payload', status.text)
  assert(
    '探活',
    body.version === extracted.version,
    `the page reports the version the archive declares (${extracted.version})`,
    () => `reported: ${String(body.version)}`,
  )
  assert(
    '探活',
    fs.existsSync(path.join(extracted.dataRoot, DATA_LAYOUT_FILE_NAME)),
    `the boot created data/${DATA_LAYOUT_FILE_NAME} under the extracted root`,
    () => `data directory: ${dataEntries(extracted.dataRoot)}`,
  )
  report(`data/ holds ${dataEntries(extracted.dataRoot)} while the program runs`)
}

/**
 * The 退出 step: the page's own exit route, then the process ending with code 0.
 * npm forwards the entry's exit code, so this is the start script's last claim.
 */
async function exitStage(started: Started): Promise<void> {
  let exit: Reply
  try {
    exit = await request(started.address, '/api/exit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: false }),
    })
  } catch (error) {
    throw new CheckFailure('退出', 'POST /api/exit did not answer', String(error))
  }
  assert('退出', exit.status === 202, `an idle exit answers 202 (got ${exit.status})`, exit.text)
  assert('退出', exitingOf(exit.body) === true, 'the exit answer says the service is exiting')

  let code: number | null
  try {
    code = await started.program.close(EXIT_TIMEOUT_MS)
  } catch (error) {
    throw atStep('退出', error)
  }
  assert('退出', code === 0, `the program exits 0 once asked (got ${String(code)})`, () =>
    started.program.output(),
  )
}

/** Remove the temporary root; a failure here must not mask the chain's verdict. */
function cleanup(root: string): void {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch (error) {
    process.stderr.write(
      `package:check: could not remove ${root}: ${error instanceof Error ? error.message : String(error)}\n`,
    )
  }
}

async function main(): Promise<void> {
  const archive = archiveOf(process.argv.slice(2))
  const declaredVersion = packageVersion(PACKAGE_FILE)

  // One temporary directory holds everything this check writes: the extracted
  // program, npm's `node_modules`, and the data directory the boot creates. It
  // is outside the repository by construction (`os.tmpdir()`), so no step can
  // read the developer's `.env`, their `data/` or their `build/`.
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 're1999-package-check-'))
  try {
    const programRoot = path.join(tempRoot, 'package')
    const extracted = extractStage(archive, programRoot, declaredVersion)
    installStage(programRoot)

    const started = await startStage(programRoot, extracted.dataRoot)
    try {
      await probeStage(started, extracted)
      await exitStage(started)
    } finally {
      await started.program.stop()
    }

    process.stdout.write(
      `package:check: the archive installs, boots and exits with code 0 (${archive})\n`,
    )
  } finally {
    cleanup(tempRoot)
  }
}

main().catch((error: unknown) => {
  if (error instanceof UsageFailure) {
    process.stderr.write(`package:check: FAILED — ${error.message}\n`)
  } else if (error instanceof CheckFailure) {
    process.stderr.write(`package:check: FAILED at ${error.step} — ${error.message}\n`)
  } else {
    process.stderr.write(
      `package:check: FAILED — ${error instanceof Error ? error.message : String(error)}\n`,
    )
  }
  process.exitCode = 1
})
