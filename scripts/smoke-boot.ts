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
// **What it cannot cover, by design.** The Windows-only surfaces stay untested
// here: `packaging/启动.bat`, `packaging/更新.bat`, the updater's real-folder
// moves (`update.js` is built but never run), and a `node_modules` junction
// (`pnpm-workspace.yaml`). The check also needs no site, no real Run and no
// `.env`: the staged tree has none, so the status read never asks the Gallery
// list, and the browser is not opened (`--no-open`). The one outbound request is
// the boot's courtesy update check; its answer is never needed and its failure is
// already "no notice".
//
// **What it writes, and where.** Only inside the temporary root: the staged
// `app`, the `data` directory and a redirected `%LOCALAPPDATA%` for the install
// pointer (the staged pair is `app` beside `data`, which is the packaged shape
// `installRootOf` recognizes). The root is removed on the way out, and its shape
// is deliberately not asserted: it is scaffolding, not the subject.
//
// Usage: `pnpm smoke:boot [built-tree]` — the tree defaults to `<repo>/build`,
// which is why CI runs `pnpm build` first.

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

/** The repository root: this script's parent, and the source of the version. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..')

/** The tree `pnpm build` writes; the argument names another one. */
const DEFAULT_TREE = path.join(REPO_ROOT, 'build')

/** The one version this repository declares; the build injects it. */
const PACKAGE_FILE = path.join(REPO_ROOT, 'package.json')

/** The two entries the refusal case needs to know about by name. */
const SERVER_ENTRY = 'server.js'
const RUN_ENTRY = 'run.js'

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

/** One API request's budget: loopback, so this is already generous. */
const REQUEST_TIMEOUT_MS = 10_000

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

/** A started program and the output it has written so far. */
interface Program {
  child: ChildProcess
  output: () => string
}

/**
 * Record one check, or stop the command at the first disagreement. Success is
 * printed as it happens so a CI log says how far the boot got; the detail is
 * what a failure prints under the label.
 */
function check(
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
 * Deleting the configuration keys is what makes "no network" a property of the
 * command rather than a property of the machine running it: with no `BASE_ORIGIN`
 * the Console derives no Gallery-list endpoint and the status read cannot ask the
 * site.
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
 * Start the staged program exactly as a packaged launcher does: this Node
 * runtime, `app/server.js`, with the two roots in the environment and no browser.
 * The working directory is the staged app root as well, so nothing can lean on
 * where the driver was started from.
 */
function startProgram(staged: Staged): Program {
  const child = spawn(
    process.execPath,
    [path.join(staged.appRoot, SERVER_ENTRY), '--no-open', '--port', '0'],
    {
      cwd: staged.appRoot,
      env: childEnvironment(staged),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )

  let output = ''
  const collect = (chunk: Buffer): void => {
    output += chunk.toString('utf8')
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  // A spawn that failed (no runtime, no entry) emits `error` and would crash an
  // emitter with no listener; the output is what the caller's report reads.
  child.once('error', error => {
    output += `${error.message}\n`
  })
  return { child, output: () => output }
}

/**
 * Wait for the startup address the program prints. The address carries this
 * boot's token, so every later request is made with it — the guard refuses a
 * request without one, and a smoke that bypassed the guard would prove nothing.
 */
function waitForAddress(program: Program): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      action()
    }
    const scan = (): void => {
      const match = BOOT_ADDRESS.exec(program.output())
      if (match !== null) finish(() => resolve(match[1]))
    }
    const timer = setTimeout(() => {
      finish(() =>
        reject(new SmokeFailure(`no boot address within ${BOOT_TIMEOUT_MS} ms`, program.output())),
      )
    }, BOOT_TIMEOUT_MS)

    program.child.stdout?.on('data', scan)
    program.child.stderr?.on('data', scan)
    program.child.once('error', error => finish(() => reject(error)))
    program.child.once('exit', code =>
      finish(() =>
        reject(
          new SmokeFailure(
            `the program exited ${String(code)} before it printed an address`,
            program.output(),
          ),
        ),
      ),
    )
    scan()
  })
}

/** Wait for the process to close, with its stdio drained; kill it at the limit. */
function waitForClose(program: Program, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      program.child.kill()
      reject(new SmokeFailure(`the program did not stop within ${timeoutMs} ms`, program.output()))
    }, timeoutMs)
    program.child.once('close', code => {
      clearTimeout(timer)
      resolve(code)
    })
  })
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

/**
 * The complete tree: start it, read its own version and address through the
 * page's API, check the record it published, and stop it through the exit route.
 */
async function caseCompleteTree(staged: Staged, expectedVersion: string): Promise<void> {
  const program = startProgram(staged)
  try {
    const address = await waitForAddress(program)
    const url = new URL(address)
    const token = url.searchParams.get('token') ?? ''
    const port = Number(url.port)
    check(token.length > 0, 'the printed address carries a boot token')

    const status = await request(address, '/api/status')
    check(status.status === 200, `GET /api/status answers 200 (got ${status.status})`, status.text)
    const head = statusOf(status)
    check(
      head.version === expectedVersion,
      `the page reports the version the build injected (${expectedVersion})`,
      () => `reported: ${String(head.version)}`,
    )

    const recordFile = path.join(staged.dataRoot, INSTANCE_RECORD_FILE_NAME)
    check(fs.existsSync(recordFile), 'the boot published the instance record')
    const record = instanceRecordOf(recordFile)
    check(record.version === INSTANCE_RECORD_VERSION, 'the instance record has a known shape')
    check(record.port === port, 'the instance record names the bound port')
    check(record.token === token, "the instance record carries this boot's token")
    check(record.pid === program.child.pid, "the instance record names this program's pid")

    const exit = await request(address, '/api/exit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: false }),
    })
    check(exit.status === 202, `an idle exit answers 202 (got ${exit.status})`, exit.text)
    check(exitingOf(exit.body) === true, 'the exit answer says the service is exiting')

    const code = await waitForClose(program, EXIT_TIMEOUT_MS)
    check(code === 0, `the program exits 0 once asked (got ${String(code)})`, program.output)
    check(!fs.existsSync(recordFile), 'the clean exit removed the instance record')
  } finally {
    await stopIfAlive(program)
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

  const program = startProgram(staged)
  try {
    const code = await waitForClose(program, BOOT_TIMEOUT_MS)
    const output = program.output()
    check(code !== 0, `a tree missing ${RUN_ENTRY} exits non-zero (got ${String(code)})`, output)
    check(!BOOT_ADDRESS.test(output), 'it refuses before it prints an address', output)
    check(output.includes(missing), 'the refusal names the artifact it is missing', output)
  } finally {
    await stopIfAlive(program)
  }
}

/** Leave nothing running, even when a check threw mid-boot. */
async function stopIfAlive(program: Program): Promise<void> {
  if (program.child.exitCode !== null) return
  program.child.kill()
  try {
    await waitForClose(program, EXIT_TIMEOUT_MS)
  } catch {
    // The temporary root is about to go; a kill that did not finish is reported
    // by the caller's own failure, not by a second one here.
  }
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
  const tree = treeOf(process.argv.slice(2))
  const expectedVersion = packageVersion(PACKAGE_FILE)

  const complete = stage(tree)
  try {
    await caseCompleteTree(complete, expectedVersion)
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
