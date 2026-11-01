// ── What the two boot checks share ─────────────────────────────────
//
// `scripts/smoke:boot` proves the built tree boots and
// `scripts/package-check.ts` proves the shipped archive installs and boots. They
// start the program the same way — the manifest's own `npm start`, with the
// arguments after `--`, from a directory outside the repository — and they ask
// it the same questions through the page's own API. That common half lives here:
//
//   - the address the Console prints (`WebUI: http://127.0.0.1:<port>/?token=…`),
//     the boot arguments and the configuration keys a child must not inherit;
//   - the child-process handle: one output buffer, the address wait, the close
//     wait, and a `stop()` that kills the whole tree npm started (Windows
//     `taskkill /T`, a process group elsewhere);
//   - one request to the page's API, with the boot token still on the URL;
//   - the `ok - ` report line, the status-payload guard, the exit answer's flag,
//     the data-directory listing and the failure-detail indent.
//
// **What stays in each command** is everything that says what the check means:
// its own steps (解压 / 安装 / 启动 / 探活 / 退出 versus the smoke's cases), its
// failure class and Chinese-process wording, its timeouts, its case list and its
// final summary. The failure factories below are the seam: each command builds
// its own error from a label and detail, so no `ok - ` line and no printed
// failure sentence moves into this module.

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import process from 'node:process'

import type { ConsoleStatusPayload } from '../web/api-types.js'
import { isRecord } from './json.js'

/** The address the Console prints once it is listening. */
export const BOOT_ADDRESS = /WebUI: (http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+)/

/**
 * The arguments the checks pass to the entry through the manifest's start
 * script: an OS-assigned port and no browser. They must arrive after `--`, which
 * is what proves the start script forwards its caller's arguments.
 */
export const BOOT_ARGS = ['--no-open', '--port', '0'] as const

/** The configuration keys a child must not inherit from the developer's shell. */
export const CONFIG_ENV_KEYS = ['BASE_ORIGIN', 'IMAGES_DIR', 'LOG_DIR', 'BATCH_SIZE', 'USER_AGENT']

/** One started program: the handle owns the child, its output and its stop. */
export interface Program {
  /** Everything the child has written so far, stdout and stderr together. */
  output(): string
  /** Resolve once the startup address is printed; reject on exit or timeout. */
  address(): Promise<string>
  /** Resolve with the exit code once the child closes; kill it at the limit. */
  close(timeoutMs: number): Promise<number | null>
  /** Leave nothing running, even when a check threw mid-boot. */
  stop(): Promise<void>
}

/** The command's own wording for a failure, and the timeouts its steps allow. */
export interface ProgramOptions {
  /** How long the program has to print its address. */
  addressTimeoutMs: number
  /** How long a requested exit has to complete before the tree is killed. */
  exitTimeoutMs: number
  /** A failure while waiting for the address: no address, or an early exit. */
  addressFailure: (message: string, detail: string) => Error
  /** A failure while closing: the process did not stop in time. */
  closeFailure: (message: string, detail: string) => Error
  /** A spawn error: the child never started. */
  spawnFailure: (error: Error) => Error
}

/** One API reply: the status, the parsed body when there is one, and the text. */
export interface Reply {
  status: number
  body: unknown
  text: string
}

/**
 * The child's environment: this machine's, minus every `RE1999_*` variable and
 * minus the site configuration it could have inherited. `overrides` is how a
 * caller points the boot at a closed origin for a check that is not about the
 * site.
 */
export function childEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('RE1999_')) delete env[key]
  }
  for (const key of CONFIG_ENV_KEYS) delete env[key]
  return { ...env, ...overrides }
}

/**
 * Stop the whole tree the start script began. `npm start` puts npm (or the shell
 * that resolved it) between the driver and the Console, so killing only the
 * direct child would leave the program holding its port. Windows kills the tree
 * with `taskkill /T`; on POSIX the child is spawned detached so its process group
 * can be signalled, with a direct kill as the fallback.
 */
export function killTree(child: ChildProcess): void {
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
 * Collect one spawned process into the handle the checks use. The output is
 * collected once, and the address wait, the close wait and every failure report
 * read that same buffer; `killTree` is how a stuck start is torn down.
 */
export function track(child: ChildProcess, options: ProgramOptions): Program {
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

  // Attached at spawn, so a process that exits before a check asks for its code
  // cannot fire `close` into the void.
  const closed = new Promise<number | null>(resolve => {
    child.once('close', code => resolve(code))
  })

  const closeWithin = (timeoutMs: number): Promise<number | null> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        killTree(child)
        reject(options.closeFailure(`the program did not stop within ${timeoutMs} ms`, output))
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
              options.addressFailure(
                `no boot address within ${options.addressTimeoutMs} ms`,
                output,
              ),
            ),
          ),
        options.addressTimeoutMs,
      )

      child.once('error', error => finish(() => reject(options.spawnFailure(error))))
      child.once('exit', code =>
        finish(() =>
          reject(
            options.addressFailure(
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
      killTree(child)
      try {
        await closeWithin(options.exitTimeoutMs)
      } catch {
        // The temporary root is about to go; a kill that did not finish is
        // reported by the caller's own failure, not by a second one here.
      }
    },
  }
}

/**
 * Start a program root the way a user does: through the manifest's own
 * `scripts.start`, with the check's arguments after `--`.
 *
 * Windows resolves `npm` through `npm.cmd`, which Node refuses to spawn without
 * a shell; the command is the check's own fixed literals, so one command string
 * is exact. POSIX spawns npm directly and detached, so a failed check can signal
 * the whole group instead of orphaning the Console.
 */
export function startShippedProgram(
  programRoot: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  options: ProgramOptions,
): Program {
  const startArgs = ['start', '--', ...args]
  const child =
    process.platform === 'win32'
      ? spawn(['npm', ...startArgs].join(' '), {
          cwd: programRoot,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: true,
        })
      : spawn('npm', startArgs, {
          cwd: programRoot,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          detached: true,
        })
  return track(child, options)
}

/** The route on the printed address, keeping the `?token=` it carries. */
function endpointOf(address: string, route: string): URL {
  const url = new URL(address)
  url.pathname = route
  return url
}

/** One request to the page's own API, with the boot token still on the URL. */
export async function request(
  address: string,
  route: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Reply> {
  const response = await fetch(endpointOf(address, route), {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
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

/** Print one check as it passes: a CI log reads how far the chain got. */
export function reportOk(what: string): void {
  process.stdout.write(`ok - ${what}\n`)
}

/**
 * Record one check, or stop the command at the first disagreement. The detail is
 * what a failure prints under the label; a function defers building it. The
 * command's own failure class and step wording enter through `failure`, so the
 * report line stays the same wherever the check runs.
 */
export function assertCheck(
  condition: unknown,
  what: string,
  detail: string | (() => string),
  failure: (message: string, detail: string) => Error,
): asserts condition {
  if (condition) {
    reportOk(what)
    return
  }
  throw failure(what, typeof detail === 'function' ? detail() : detail)
}

/** The fields that identify `/api/status`, so the version can be read safely. */
export function isStatusPayload(body: unknown): body is ConsoleStatusPayload {
  return isRecord(body) && 'version' in body && 'state' in body && 'runConfigAvailable' in body
}

/** The exit answer's one flag, or `null` when the body is not that contract. */
export function exitingOf(body: unknown): boolean | null {
  if (!isRecord(body) || !('exiting' in body)) return null
  return typeof body.exiting === 'boolean' ? body.exiting : null
}

/** What is directly under the data directory, for the check's own report. */
export function dataEntries(dataRoot: string): string {
  try {
    const names = fs.readdirSync(dataRoot).toSorted()
    return names.length === 0 ? '(empty)' : names.join(', ')
  } catch {
    return '(missing)'
  }
}

/** Indent a detail block under its label, so one failure stays one log entry. */
export function indent(text: string): string {
  const trimmed = text.trimEnd()
  if (trimmed === '') return ''
  return trimmed
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')
}
