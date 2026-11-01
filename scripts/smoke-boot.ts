#!/usr/bin/env node
// ── Boot the built tree (#108, #117) ────────────────────────────────
//
// `pnpm build` writes `build/`, and `build/` is the program: the bundles, the
// page and the shipped manifest, run by Node with no `node_modules`, no `tsx`
// and no `vite`. Typecheck, lint and the unit tests never load that tree, which
// is how an ESM bundle of a CommonJS package can import-fail after every one of
// them passed: only booting the artifact catches that class
// (`scripts/build.ts` › `CJS_INTEROP_BANNER`).
//
// This command is the check that does boot it, and since #117 it boots it in the
// shipped shape: the copy of `build/` IS the install root (no `app/` level), no
// `RE1999_*` variable is set, and the start goes through the manifest's own
// script — `npm start -- --no-open --port 0`. That is more than a direct
// `node server.js` boot: npm runs the script with the package root as its
// working directory, so the zero-argument root resolution has to land on the
// tree itself, `<root>/data` is where the data must appear, and the arguments
// after `--` must still reach the entry.
//
// Then it drives the program only through the page's own API:
//
//   - `GET /api/status` with the token the printed address carries, which must
//     report the version the build injected (`RE1999_VERSION`, #79/#84);
//   - `<root>/data/instance.json`, the record of the address this boot published
//     (#82), which must name the bound port and this boot's token;
//   - `<root>/data/layout.json`, which proves the boot created the data
//     directory under its own root;
//   - `POST /api/exit`, which must answer `202` and end the process with code 0.
//
// Then it stages the same tree again with `run.js` removed and requires the boot
// refusal: a non-zero exit before an address is printed, naming the artifact it
// is missing. That refusal (`web/server/build-artifacts.ts`) is a rule only the
// artifact can demonstrate — a unit test injects the missing file, this runs the
// program.
//
// Finally it runs the third entry, `update.js`, against the staged root with no
// installation pointer in the redirected `%LOCALAPPDATA%`: the updater must
// resolve no installation, refuse in Chinese and exit non-zero before it moves
// anything. That is the updater's bundle proven to load; its real folder swap is
// still not exercised here. (#119 removes this case with the updater.)
//
// **What "no network" means here.** The staged tree has no `.env`, so the status
// read never asks the Gallery list, and `--no-open` keeps the browser shut. It
// needs no real Run either. The boot does make one outbound request of its own —
// the Console's courtesy update check (`web/server/update-check.ts`), bounded at
// three seconds and never fatal — and this command neither silences it nor
// pretends it does not happen. So: no `.env`, no browser and no real Run; the
// only outbound request is that bounded check.
//
// **What the CI claim covers.** The build compiles all three entries; this
// command boots the Console and runs the updater's refusal. `run.js` is compiled
// but never executed, so a bundling failure that only `run.js` has stays green —
// named here rather than implied away.
//
// **What it cannot cover, by design.** The Windows-only surfaces stay untested
// here: `packaging/启动.bat`, `packaging/更新.bat`, and the updater's real-folder
// moves. (`pnpm smoke:boot` itself runs on Linux in CI and on Windows here.)
//
// **What it writes, and where.** Only inside the temporary root: the staged
// program files at the root itself, the `data/` the boot creates under it, and a
// redirected `%LOCALAPPDATA%` for the updater case. A flat root writes no
// install pointer (`installRootOf` recognises only the old `<install>\app`
// pair), so the redirect is for the updater's read, not the boot's write. The
// root is removed on the way out, and its shape is deliberately not asserted: it
// is scaffolding, not the subject.
//
// **A port the fetch standard blocks.** `--port 0` lets the OS choose, and on
// this machine the dynamic range (1024–15000) includes ports `fetch` refuses
// (`bad port`, 3659 among them). The server binds one happily and the driver's
// own request then fails through no fault of the program, so the console case
// retries the whole boot with a fresh port twice before letting the failure
// through. Bounded and deterministic: at most three boots, and any other failure
// is reported on the first attempt.
//
// Usage: `pnpm smoke:boot [built-tree]` — the tree defaults to `<repo>/build`,
// and both cases stage it, which is why CI runs `pnpm build` first.

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

import { DATA_LAYOUT_FILE_NAME } from '../core/data-layout.js'
import type { ConsoleStatusPayload } from '../web/api-types.js'
import {
  INSTANCE_RECORD_FILE_NAME,
  INSTANCE_RECORD_VERSION,
} from '../web/server/instance-record.js'
import { packageVersion } from './package-version.js'

/** The repository root: this script's parent. The version comes from `PACKAGE_FILE`. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..')

/** The tree `pnpm build` writes; the argument names another one. */
const DEFAULT_TREE = path.join(REPO_ROOT, 'build')

/** The one version this repository declares; the build injects it. */
const PACKAGE_FILE = path.join(REPO_ROOT, 'package.json')

/** The entries this command starts or names by name. */
const SERVER_ENTRY = 'server.js'
const RUN_ENTRY = 'run.js'
const UPDATE_ENTRY = 'update.js'

/**
 * The arguments the check passes to the entry through the manifest's start
 * script: an OS-assigned port and no browser. They must arrive after `--`, which
 * is what proves the start script forwards its caller's arguments.
 */
const BOOT_ARGS = ['--no-open', '--port', '0'] as const

/**
 * The address the Console prints once it is listening: the loopback origin, the
 * page's `/`, and the token every request must carry. Parsing it is how the
 * driver learns the port and the token without reading the instance record
 * first — the record is then checked against what the address said.
 */
const BOOT_ADDRESS = /WebUI: (http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+)/

/** A boot that prints no address in this long is not going to. */
const BOOT_TIMEOUT_MS = 30_000

/** An accepted exit answers on the spot and stops the process shortly after. */
const EXIT_TIMEOUT_MS = 10_000

/** The updater's refusal is immediate; this is only a bound on a hung process. */
const UPDATER_TIMEOUT_MS = 10_000

/** One API request's budget: loopback, so this is already generous. */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * How many more boots a port `fetch` refuses is worth. The OS assigns the port,
 * and a blocked one is the OS's pick, not the program's fault; two fresh boots
 * make the check's own probability of a false red effectively zero.
 */
const PORT_RETRIES = 2

/**
 * The staged tree's version metadata is rewritten to this, so a status payload
 * that reports the real version can only have got it from the build's injected
 * `RE1999_VERSION` — never from the packaged `package.json` fallback.
 */
const STAGED_VERSION = '0.0.0-smoke'

/** The configuration keys the child must not inherit from the developer. */
const CONFIG_ENV_KEYS = ['BASE_ORIGIN', 'IMAGES_DIR', 'LOG_DIR', 'BATCH_SIZE', 'USER_AGENT']

/** A check that failed: the label says which disagreement stopped the command. */
class SmokeFailure extends Error {
  constructor(message: string, detail = '') {
    super(detail.trim() === '' ? message : `${message}\n${indent(detail)}`)
  }
}

/** One staged copy of the built tree, which is itself the install root. */
interface Staged {
  /** The temporary root: the program files, so the program root IS this root. */
  root: string
  /** `<root>/data` — where the boot must create its data. */
  dataRoot: string
}

/**
 * One started program. The handle owns the child, its output, the address wait,
 * the close wait and the stop, so a case never subscribes to the same process
 * twice and no process outlives the case that started it.
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

/**
 * Record one check, or stop the command at the first disagreement. Success is
 * printed as it happens so a CI log says how far the boot got; the detail is
 * what a failure prints under the label.
 */
function assertAndReport(
  condition: unknown,
  what: string,
  detail: string | (() => string) = '',
): asserts condition {
  if (condition) {
    process.stdout.write(`ok - ${what}\n`)
    return
  }
  throw new SmokeFailure(what, typeof detail === 'function' ? detail() : detail)
}

/** The one tree to stage: the build by default, or the argument. */
function treeOf(argv: readonly string[]): string {
  if (argv.length === 0) return DEFAULT_TREE
  if (argv.length === 1 && argv[0].trim() !== '') return path.resolve(argv[0])
  throw new SmokeFailure('usage: pnpm smoke:boot [built-tree]')
}

/**
 * Copy the built tree into a fresh temporary root, so the copy IS the install
 * root (#117): no `app/` level, and `<root>/data` is the data directory a
 * shipped start must create.
 *
 * The staged `package.json`'s version is rewritten while everything else — the
 * start script above all — is kept. The rewrite is the point: `core/version.ts`
 * falls back to the application root's metadata when the build injected nothing,
 * so a status payload that reports the real version despite this metadata proves
 * the `define` reached the bundle — the seam this command exists for.
 */
function stage(tree: string): Staged {
  if (!fs.existsSync(path.join(tree, SERVER_ENTRY))) {
    throw new SmokeFailure(
      `no built tree at ${tree} — run pnpm build first`,
      'the smoke stages a complete install root, not sources',
    )
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 're1999-smoke-'))
  // Entry by entry, because the destination already exists: the tree's contents
  // land at the root, they are not nested under another directory.
  for (const name of fs.readdirSync(tree)) {
    fs.cpSync(path.join(tree, name), path.join(root, name), { recursive: true })
  }
  rewriteStagedVersion(root)
  return { root, dataRoot: path.join(root, 'data') }
}

/** Keep the staged tree ESM and startable, but make its metadata useless as a version source. */
function rewriteStagedVersion(root: string): void {
  const file = path.join(root, 'package.json')
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!isRecord(parsed)) {
    throw new SmokeFailure(`${file} is not a JSON object`)
  }
  fs.writeFileSync(
    file,
    `${JSON.stringify({ ...parsed, version: STAGED_VERSION }, null, 2)}\n`,
    'utf8',
  )
}

/**
 * The child's environment: this machine's, minus every `RE1999_*` variable and
 * minus the site configuration it could have inherited, plus a redirected
 * `%LOCALAPPDATA%` for the updater case.
 *
 * `RE1999_APP_ROOT` / `RE1999_DATA_ROOT` are exactly what a shipped start does
 * not set (#117): `npm start` runs `node server.js` with the package root as the
 * working directory, and `dataRootOf` defaults to `<appRoot>/data`, so both
 * roots must resolve to the staged root without help. Clearing the whole
 * `RE1999_` prefix also removes `RE1999_VERSION`/`RE1999_NODE_FLOOR` if the
 * developer happened to export them — the bundle carries its own.
 *
 * Deleting the configuration keys is what keeps the status read from asking the
 * site: with no `BASE_ORIGIN` the Console derives no Gallery-list endpoint. It
 * does not make the boot request-free — the courtesy update check still runs —
 * so "no network" is not this command's claim; "no site request" is.
 */
function childEnvironment(staged: Staged): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('RE1999_')) delete env[key]
  }
  for (const key of CONFIG_ENV_KEYS) delete env[key]
  // The updater case reads `%LOCALAPPDATA%`'s install pointer; it must not find
  // this machine's real one. The flat boot writes none (`installRootOf`
  // recognises only the old `<install>\app` pair), so this redirect is for the
  // updater's read alone.
  env.LOCALAPPDATA = path.join(staged.root, 'localappdata')
  return env
}

/**
 * Stop the direct child only. The updater's own process exits at once; this is
 * only for a hung one, and it has no grandchildren to leave behind.
 */
function killDirect(child: ChildProcess): void {
  child.kill()
}

/**
 * Stop the whole tree the start script began. `npm start` puts npm (or the
 * shell that resolved it) between this driver and the Console, so killing only
 * the direct child would leave the program holding its port. Windows kills the
 * tree with `taskkill /T`; on POSIX the child is spawned detached so its process
 * group can be signalled, with a direct kill as the fallback.
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
 * Collect one spawned process into the handle the cases use. The output is
 * collected once, and the address wait, the close wait and every failure report
 * read that same buffer; `killChild` is how a stuck start is torn down.
 */
function track(child: ChildProcess, killChild: (child: ChildProcess) => void): Program {
  let output = ''
  let onChunk: (() => void) | null = null
  const collect = (chunk: Buffer): void => {
    output += chunk.toString('utf8')
    onChunk?.()
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  // A spawn that failed (no runtime, no entry) emits `error` and would crash an
  // emitter with no listener; the output is what the caller's report reads.
  child.once('error', error => {
    output += `${error.message}\n`
    onChunk?.()
  })

  // Attached at spawn, so a process that exits before a case asks for its code
  // cannot fire `close` into the void. The updater exits this fast.
  const closed = new Promise<number | null>(resolve => {
    child.once('close', code => resolve(code))
  })

  const closeWithin = (timeoutMs: number): Promise<number | null> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        killChild(child)
        reject(new SmokeFailure(`the program did not stop within ${timeoutMs} ms`, output))
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
            reject(new SmokeFailure(`no boot address within ${BOOT_TIMEOUT_MS} ms`, output)),
          ),
        BOOT_TIMEOUT_MS,
      )

      child.once('error', error => finish(() => reject(error)))
      child.once('exit', code =>
        finish(() =>
          reject(
            new SmokeFailure(
              `the program exited ${String(code)} before it printed an address`,
              output,
            ),
          ),
        ),
      )
      onChunk = scan
      scan()
    })

  let address: Promise<string> | null = null
  return {
    output: () => output,
    address: () => (address ??= waitForAddress()),
    close: closeWithin,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        await closed.catch(() => null)
        return
      }
      killChild(child)
      try {
        await closeWithin(EXIT_TIMEOUT_MS)
      } catch {
        // The temporary root is about to go; a kill that did not finish is
        // reported by the caller's own failure, not by a second one here.
      }
    },
  }
}

/**
 * Start one entry with this Node runtime, for the case that still names an entry
 * directly (the updater's refusal). The working directory is the staged root, so
 * nothing can lean on where the driver was started from.
 */
function startEntry(staged: Staged, entry: string, args: readonly string[] = []): Program {
  const child = spawn(process.execPath, [path.join(staged.root, entry), ...args], {
    cwd: staged.root,
    env: childEnvironment(staged),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  return track(child, killDirect)
}

/**
 * Start the staged tree the way a user does: through the manifest's own
 * `scripts.start`, with the check's arguments after `--` (#117).
 *
 * Windows resolves `npm` through `npm.cmd`, which Node refuses to spawn without
 * a shell; the command is the check's own fixed literals, so one command string
 * is exact. POSIX spawns npm directly and detached, so a failed check can signal
 * the whole group instead of orphaning the Console.
 */
function startShippedProgram(staged: Staged, args: readonly string[]): Program {
  const startArgs = ['start', '--', ...args]
  const child =
    process.platform === 'win32'
      ? spawn(['npm', ...startArgs].join(' '), {
          cwd: staged.root,
          env: childEnvironment(staged),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: true,
        })
      : spawn('npm', startArgs, {
          cwd: staged.root,
          env: childEnvironment(staged),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          detached: true,
        })
  return track(child, killTree)
}

/** How a case starts the staged tree: the shipped start script, or one entry. */
type ProgramStarter = (staged: Staged) => Program

/** Start the staged program, run one case against it, and always stop it. */
async function withStartedProgram(
  staged: Staged,
  start: ProgramStarter,
  body: (program: Program) => Promise<void>,
): Promise<void> {
  const program = start(staged)
  try {
    await body(program)
  } finally {
    await program.stop()
  }
}

/** The route on the printed address, keeping the `?token=` it carries. */
function endpointOf(address: string, route: string): URL {
  const url = new URL(address)
  url.pathname = route
  return url
}

interface Reply {
  status: number
  body: unknown
  text: string
}

/** One request to the page's own API, with the boot token still on the URL. */
async function request(address: string, route: string, init: RequestInit = {}): Promise<Reply> {
  const response = await fetch(endpointOf(address, route), {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    // A non-JSON body is reported by the caller's status check; `text` carries it.
  }
  return { status: response.status, body, text }
}

/** A JSON object, checked without trusting the response's shape. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The fields that identify `/api/status`, so the version can be read safely. */
function isStatusPayload(body: unknown): body is ConsoleStatusPayload {
  return isRecord(body) && 'version' in body && 'state' in body && 'runConfigAvailable' in body
}

/** The status payload, or a failure naming what arrived instead. */
function statusOf(reply: Reply): ConsoleStatusPayload {
  const body = reply.body
  if (!isStatusPayload(body)) {
    throw new SmokeFailure('GET /api/status answered no status payload', reply.text)
  }
  return body
}

/** The record the boot published: `version`, `port`, `token`, `pid`. */
function instanceRecordOf(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!isRecord(parsed)) throw new SmokeFailure('the instance record is not a JSON object')
  return parsed
}

/** The exit answer's one flag, or `null` when the body is not that contract. */
function exitingOf(body: unknown): boolean | null {
  if (!isRecord(body) || !('exiting' in body)) return null
  return typeof body.exiting === 'boolean' ? body.exiting : null
}

/** Whether the text carries at least one CJK character, so "Chinese" is observed. */
function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/u.test(text)
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
 * The complete tree: start it through its manifest, read its own version and
 * address through the page's API, check the record it published and the data
 * directory it created, and stop it through the exit route.
 */
async function caseCompleteTree(staged: Staged, expectedVersion: string): Promise<void> {
  await withStartedProgram(
    staged,
    stagedTree => startShippedProgram(stagedTree, BOOT_ARGS),
    async program => {
      const address = await program.address()
      const url = new URL(address)
      const token = url.searchParams.get('token') ?? ''
      const port = Number(url.port)
      assertAndReport(token.length > 0, 'the printed address carries a boot token')

      const status = await request(address, '/api/status')
      assertAndReport(
        status.status === 200,
        `GET /api/status answers 200 (got ${status.status})`,
        status.text,
      )
      const head = statusOf(status)
      assertAndReport(
        head.version === expectedVersion,
        `the page reports the version the build injected (${expectedVersion})`,
        () => `reported: ${String(head.version)}`,
      )

      const recordFile = path.join(staged.dataRoot, INSTANCE_RECORD_FILE_NAME)
      const layoutFile = path.join(staged.dataRoot, DATA_LAYOUT_FILE_NAME)
      assertAndReport(
        fs.existsSync(recordFile),
        'the boot published the instance record under its own data directory',
      )
      const record = instanceRecordOf(recordFile)
      assertAndReport(
        record.version === INSTANCE_RECORD_VERSION,
        'the instance record has a known shape',
      )
      assertAndReport(record.port === port, 'the instance record names the bound port')
      assertAndReport(record.token === token, "the instance record carries this boot's token")
      // #117: the start is `npm start`, so this driver's child is npm (or the
      // shell that resolved it) and the record's pid is Node's. The record's
      // real content is the port and this boot's token; the pid only has to name
      // a real process, never to equal the driver's child.
      assertAndReport(
        typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0,
        'the instance record names the running program by a positive pid',
        () => `recorded: ${String(record.pid)}`,
      )

      assertAndReport(
        fs.existsSync(layoutFile),
        `the boot created data/${DATA_LAYOUT_FILE_NAME} at the install root`,
        () => `data directory: ${dataEntries(staged.dataRoot)}`,
      )
      process.stdout.write(
        `ok - data/ holds ${dataEntries(staged.dataRoot)} while the program runs\n`,
      )

      const exit = await request(address, '/api/exit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: false }),
      })
      assertAndReport(
        exit.status === 202,
        `an idle exit answers 202 (got ${exit.status})`,
        exit.text,
      )
      assertAndReport(exitingOf(exit.body) === true, 'the exit answer says the service is exiting')

      const code = await program.close(EXIT_TIMEOUT_MS)
      assertAndReport(code === 0, `the program exits 0 once asked (got ${String(code)})`, () =>
        program.output(),
      )
      assertAndReport(!fs.existsSync(recordFile), 'the clean exit removed the instance record')
    },
  )
}

/**
 * Why the console case may run again with a fresh port: `fetch` refuses a
 * WHATWG-blocked port, which the OS can hand out through `--port 0` on this
 * machine. The program bound the port and answered the printed address; the
 * failure is the driver's, and a fresh boot is the fix.
 */
function isBlockedPortFailure(error: unknown): boolean {
  return (
    error instanceof Error && error.cause instanceof Error && /bad port/i.test(error.cause.message)
  )
}

/**
 * The console case, retried when the OS picks a port `fetch` refuses. Bounded by
 * `PORT_RETRIES`; every other failure is reported on the first attempt.
 */
async function caseCompleteTreeWithPortRetry(
  staged: Staged,
  expectedVersion: string,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await caseCompleteTree(staged, expectedVersion)
      return
    } catch (error) {
      if (attempt >= PORT_RETRIES || !isBlockedPortFailure(error)) throw error
      process.stdout.write(
        `retry - the OS chose a port fetch refuses; booting again with a fresh port (retry ${attempt + 1}/${PORT_RETRIES})\n`,
      )
    }
  }
}

/**
 * The broken tree: one artifact removed, so the boot must refuse before it binds
 * a port. The start is the same `npm start` as the complete case (#117), so the
 * refusal is proven in the shipped shape too: a non-zero exit (npm forwards the
 * entry's code), no address printed, and the missing artifact named.
 */
async function caseMissingArtifact(staged: Staged): Promise<void> {
  const missing = path.join(staged.root, RUN_ENTRY)
  fs.rmSync(missing, { force: true })

  await withStartedProgram(
    staged,
    stagedTree => startShippedProgram(stagedTree, BOOT_ARGS),
    async program => {
      const code = await program.close(BOOT_TIMEOUT_MS)
      const output = program.output()
      assertAndReport(
        code !== 0,
        `a tree missing ${RUN_ENTRY} exits non-zero (got ${String(code)})`,
        output,
      )
      assertAndReport(!BOOT_ADDRESS.test(output), 'it refuses before it prints an address', output)
      assertAndReport(
        output.includes(missing),
        'the refusal names the artifact it is missing',
        output,
      )
    },
  )
}

/**
 * The updater's third entry, exercised through its own refusal: the staged
 * package has no installation pointer in the redirected `%LOCALAPPDATA%`, so
 * `update.js` resolves no installation and says so in Chinese with a non-zero
 * exit — before it probes for a running service and before it moves a file. It
 * stays offline, immediate and inside the temporary root.
 */
async function caseUpdaterRefusal(staged: Staged): Promise<void> {
  await withStartedProgram(
    staged,
    stagedTree => startEntry(stagedTree, UPDATE_ENTRY, [stagedTree.root]),
    async program => {
      const code = await program.close(UPDATER_TIMEOUT_MS)
      const output = program.output()
      assertAndReport(
        code !== 0,
        `a tree with no installation pointer makes ${UPDATE_ENTRY} exit non-zero (got ${String(code)})`,
        output,
      )
      assertAndReport(hasChinese(output), `${UPDATE_ENTRY} refuses in Chinese`, output)
    },
  )
}

/** Remove the temporary root; a failure here must not mask the boot's verdict. */
function cleanup(root: string): void {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch (error) {
    process.stderr.write(
      `smoke: could not remove ${root}: ${error instanceof Error ? error.message : String(error)}\n`,
    )
  }
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

async function main(): Promise<void> {
  // The argument names the tree both staged runs start from: the complete one
  // boots and answers, the broken one loses `run.js` from a copy of the same tree.
  const tree = treeOf(process.argv.slice(2))
  const expectedVersion = packageVersion(PACKAGE_FILE)

  const complete = stage(tree)
  try {
    // #117: the staged root carries no `data/` — the build writes only the
    // program — so a boot that answers and publishes a record there proves the
    // data root resolved to the install root with no environment variable.
    assertAndReport(
      !fs.existsSync(complete.dataRoot),
      'the staged install root carries no data directory yet',
    )
    await caseCompleteTreeWithPortRetry(complete, expectedVersion)
    await caseUpdaterRefusal(complete)
  } finally {
    cleanup(complete.root)
  }

  const broken = stage(tree)
  try {
    await caseMissingArtifact(broken)
  } finally {
    cleanup(broken.root)
  }

  process.stdout.write(
    `smoke: the built tree boots as a flat install root and refuses without its artifacts (${tree})\n`,
  )
}

main().catch((error: unknown) => {
  process.stderr.write(
    `smoke: FAILED — ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
