#!/usr/bin/env node
// ── Boot the built tree (#108) ──────────────────────────────────────
//
// `pnpm build` writes `build/`, and `build/` is the program: three bundles and
// the page, run by Node with no `node_modules`, no `tsx` and no `vite`. Typecheck,
// lint and the unit tests never load that tree, which is how an ESM bundle of a
// CommonJS package can import-fail after every one of them passed: only booting
// the artifact catches that class (`scripts/build.ts` › `CJS_INTEROP_BANNER`).
//
// This command is the check that does boot it. It copies the tree into a
// temporary application root, starts `server.js` on an OS-assigned port with the
// browser suppressed, and drives the program only through the page's own API:
//
//   - `GET /api/status` with the token the printed address carries, which must
//     report the version the build injected (`RE1999_VERSION`, #79/#84);
//   - `<data>/instance.json`, the record of the address this boot published
//     (#82), which must name the port, token and pid of the process just started;
//   - `POST /api/exit`, which must answer `202` and end the process with code 0.
//
// Then it stages the same tree again with `run.js` removed and requires the boot
// refusal: a non-zero exit before an address is printed, naming the artifact it
// is missing. That refusal (`web/server/build-artifacts.ts`) is a rule only the
// artifact can demonstrate — a unit test injects the missing file, this runs the
// program.
//
// Finally it runs the third entry, `update.js`, against the staged package with
// no installation pointer in the redirected `%LOCALAPPDATA%`: the updater must
// resolve no installation, refuse in Chinese and exit non-zero before it moves
// anything. That is the updater's bundle proven to load; its real folder swap is
// still not exercised here.
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
// here: `packaging/启动.bat`, `packaging/更新.bat`, the updater's real-folder
// moves, and a `node_modules` junction (`pnpm-workspace.yaml`).
//
// **What it writes, and where.** Only inside the temporary root: the staged
// `app`, the `data` directory and a redirected `%LOCALAPPDATA%` for the install
// pointer (the staged pair is `app` beside `data`, which is the packaged shape
// `installRootOf` recognizes). The root is removed on the way out, and its shape
// is deliberately not asserted: it is scaffolding, not the subject.
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

import { APP_ROOT_ENV, DATA_ROOT_ENV } from '../core/app-root.js'
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

/** One staged copy of the built tree, and its private data directory. */
interface Staged {
  /** The temporary root holding everything this run writes. */
  root: string
  /** `<root>/app` — the staged program. */
  appRoot: string
  /** `<root>/data` — the staged data directory, empty on purpose. */
  dataRoot: string
}

/**
 * One started program. The handle owns the child, its output, the address wait,
 * the close wait and the stop, so a case never subscribes to the same process
 * twice and no process outlives the case that started it.
 */
interface Program {
  child: ChildProcess
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
 * Copy the built tree into a fresh temporary root, and rewrite the staged
 * `package.json`'s version while keeping it an ESM package.
 *
 * The rewrite is the point: `core/version.ts` falls back to the application
 * root's metadata when the build injected nothing, so a status payload that
 * reports the real version despite this metadata proves the `define` reached the
 * bundle — the seam this command exists for.
 */
function stage(tree: string): Staged {
  if (!fs.existsSync(path.join(tree, SERVER_ENTRY))) {
    throw new SmokeFailure(
      `no built tree at ${tree} — run pnpm build first`,
      'the smoke stages a complete application root, not sources',
    )
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 're1999-smoke-'))
  const appRoot = path.join(root, 'app')
  const dataRoot = path.join(root, 'data')
  fs.cpSync(tree, appRoot, { recursive: true })
  rewriteStagedVersion(appRoot)
  return { root, appRoot, dataRoot }
}

/** Keep the staged tree ESM, but make its metadata useless as a version source. */
function rewriteStagedVersion(appRoot: string): void {
  const file = path.join(appRoot, 'package.json')
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
 * The child's environment: this machine's, minus the site configuration it could
 * have inherited, plus the two injected roots and a redirected `%LOCALAPPDATA%`.
 *
 * Deleting the configuration keys is what keeps the status read from asking the
 * site: with no `BASE_ORIGIN` the Console derives no Gallery-list endpoint. It
 * does not make the boot request-free — the courtesy update check still runs —
 * so "no network" is not this command's claim; "no site request" is.
 */
function childEnvironment(staged: Staged): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of CONFIG_ENV_KEYS) delete env[key]
  env[APP_ROOT_ENV] = staged.appRoot
  env[DATA_ROOT_ENV] = staged.dataRoot
  env.LOCALAPPDATA = path.join(staged.root, 'localappdata')
  return env
}

/**
 * Start one entry of the staged program exactly as a packaged launcher does:
 * this Node runtime, a file inside `app/`, with the two roots in the environment.
 * The working directory is the staged app root as well, so nothing can lean on
 * where the driver was started from.
 *
 * The output is collected once, and the address wait, the close wait and every
 * failure report read that same buffer.
 */
function startProgram(staged: Staged, entry: string, args: readonly string[] = []): Program {
  const child = spawn(process.execPath, [path.join(staged.appRoot, entry), ...args], {
    cwd: staged.appRoot,
    env: childEnvironment(staged),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

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
        child.kill()
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
    child,
    output: () => output,
    address: () => (address ??= waitForAddress()),
    close: closeWithin,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        await closed.catch(() => null)
        return
      }
      child.kill()
      try {
        await closeWithin(EXIT_TIMEOUT_MS)
      } catch {
        // The temporary root is about to go; a kill that did not finish is
        // reported by the caller's own failure, not by a second one here.
      }
    },
  }
}

/** Start the staged entry, run one case against it, and always stop it. */
async function withStartedProgram(
  staged: Staged,
  entry: string,
  args: readonly string[],
  body: (program: Program) => Promise<void>,
): Promise<void> {
  const program = startProgram(staged, entry, args)
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

/**
 * The complete tree: start it, read its own version and address through the
 * page's API, check the record it published, and stop it through the exit route.
 */
async function caseCompleteTree(staged: Staged, expectedVersion: string): Promise<void> {
  await withStartedProgram(staged, SERVER_ENTRY, ['--no-open', '--port', '0'], async program => {
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
    assertAndReport(fs.existsSync(recordFile), 'the boot published the instance record')
    const record = instanceRecordOf(recordFile)
    assertAndReport(
      record.version === INSTANCE_RECORD_VERSION,
      'the instance record has a known shape',
    )
    assertAndReport(record.port === port, 'the instance record names the bound port')
    assertAndReport(record.token === token, "the instance record carries this boot's token")
    assertAndReport(
      record.pid === program.child.pid,
      "the instance record names this program's pid",
    )

    const exit = await request(address, '/api/exit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: false }),
    })
    assertAndReport(exit.status === 202, `an idle exit answers 202 (got ${exit.status})`, exit.text)
    assertAndReport(exitingOf(exit.body) === true, 'the exit answer says the service is exiting')

    const code = await program.close(EXIT_TIMEOUT_MS)
    assertAndReport(code === 0, `the program exits 0 once asked (got ${String(code)})`, () =>
      program.output(),
    )
    assertAndReport(!fs.existsSync(recordFile), 'the clean exit removed the instance record')
  })
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
 * a port. The refusal's own sentence is not asserted — only that the program
 * exits non-zero, prints no address, and names the artifact it is missing.
 */
async function caseMissingArtifact(staged: Staged): Promise<void> {
  const missing = path.join(staged.appRoot, RUN_ENTRY)
  fs.rmSync(missing, { force: true })

  await withStartedProgram(staged, SERVER_ENTRY, ['--no-open', '--port', '0'], async program => {
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
  })
}

/**
 * The updater's third entry, exercised through its own refusal: the staged
 * package has no installation pointer in the redirected `%LOCALAPPDATA%`, so
 * `update.js` resolves no installation and says so in Chinese with a non-zero
 * exit — before it probes for a running service and before it moves a file. It
 * stays offline, immediate and inside the temporary root.
 */
async function caseUpdaterRefusal(staged: Staged): Promise<void> {
  await withStartedProgram(staged, UPDATE_ENTRY, [staged.root], async program => {
    const code = await program.close(UPDATER_TIMEOUT_MS)
    const output = program.output()
    assertAndReport(
      code !== 0,
      `a tree with no installation pointer makes ${UPDATE_ENTRY} exit non-zero (got ${String(code)})`,
      output,
    )
    assertAndReport(hasChinese(output), `${UPDATE_ENTRY} refuses in Chinese`, output)
  })
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

  process.stdout.write(`smoke: the built tree boots and refuses without its artifacts (${tree})\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(
    `smoke: FAILED — ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
