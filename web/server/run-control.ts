// ── Run control: starting and owning a Run's process ────────────────
//
// A Run is spawned as the current Node binary with the tsx entry as its first
// argument, in the repository root — never through a shell, never through `npx`
// or `pnpm` (spec decision 6).
// The Console adds no pipe of its own: the Run's own children need pipes and a
// confined host refuses a second one, so the child inherits the Console's
// stdout/stderr (`stdio: ['ignore', 'inherit', 'inherit']`). Its output is
// not the Run's truth in any case — the Run log is (ADR 0009).

import { spawn as defaultSpawn } from 'node:child_process'
import process from 'node:process'

import type { ConsoleRunState } from '../api-types.js'
import type { RunCleaner, RunStartResult, RunStarter } from './server.js'

export interface RunLauncher {
  /** Spawns the Run and returns at once. Throws when one is already alive. */
  start(): void
  /** `true` while the child this launcher started is still running. */
  isAlive(): boolean
  /**
   * Kills the whole tree the launcher started — the tsx loader, the browser CLI
   * and the real browser — because on Windows a parent's death does not take
   * its children (ADR 0009). A no-op when nothing is alive. #36 completes the
   * tree kill; the seam exists here so no caller has to invent one.
   */
  stop(): void
}

export interface RunLauncherDeps {
  /** The current Node binary (`process.execPath`). */
  nodePath: string
  /** `<root>/node_modules/tsx/dist/cli.mjs` — the tsx CLI entry, not `npx`. */
  tsxEntry: string
  /** `<root>/core/main.ts` — the same entry `pnpm save-wallpapers` runs. */
  mainEntry: string
  /** The repository root: the Run's cwd, and where `.env` and `logs/` live. */
  projectRoot: string
  /** Injected so a test can assert the platform's own tree-kill shape. */
  platform?: NodeJS.Platform
  /** Injected so a test can watch the argv without spawning anything. */
  spawn?: typeof import('node:child_process').spawn
  /** Injected so a test can assert the tree kill without killing anything. */
  killTree?: (pid: number) => void
  /**
   * Called after a successful spawn and before the Run writes its first record:
   * the Console uses it to note which Run log directory it is looking at (#36).
   */
  onStarted?: () => void
  /** Called when the child exits — success, failure or death all count (#36). */
  onExited?: () => void
}

/**
 * The launcher seam (spec decision 6).
 *
 * The child is never `npx` and never a shell: on Windows both are `.cmd`/`.ps1`
 * shims that need `shell: true`, and cmd.exe mangles the arguments a launcher
 * like that would pass (AGENTS.md). `env` is the Console's own environment, so
 * the Run sees the same machine.
 */
export function createRunLauncher(deps: RunLauncherDeps): RunLauncher {
  const spawn = deps.spawn ?? defaultSpawn
  const platform = deps.platform ?? process.platform
  const killTree = deps.killTree ?? ((pid: number) => killProcessTree(pid, { platform }))
  let child: ReturnType<typeof spawn> | null = null
  let alive = false

  function start(): void {
    if (alive) throw new Error('a Run is already in flight')
    const spawned = spawn(deps.nodePath, [deps.tsxEntry, deps.mainEntry], {
      cwd: deps.projectRoot,
      shell: false,
      windowsHide: true,
      // Off Windows the child has to lead its own process group, because that
      // is what `process.kill(-pid)` signals; on Windows `taskkill /T` walks the
      // tree instead, so a detached child would only lose the console's handle
      // on it.
      detached: platform !== 'win32',
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,
    })
    child = spawned
    alive = true
    deps.onStarted?.()
    spawned.on('exit', () => {
      alive = false
      deps.onExited?.()
    })
    spawned.on('error', () => {
      alive = false
    })
  }

  function isAlive(): boolean {
    return alive
  }

  function stop(): void {
    if (!alive || child === null) return
    const pid = child.pid
    alive = false
    child = null
    if (pid !== undefined) killTree(pid)
  }

  return { start, isAlive, stop }
}

export interface KillTreeDeps {
  /** Injected so a test can read the platform's own tree-kill shape. */
  platform?: NodeJS.Platform
  /** Injected so a test can assert `taskkill` without spawning it. */
  spawn?: typeof import('node:child_process').spawn
  /** `process.kill`, injected so a test can watch the group signal. */
  kill?: (pid: number, signal: NodeJS.Signals) => void
}

/**
 * The whole-tree kill (ADR 0009; conventions §6). On Windows, `taskkill /T` is
 * the OS's own tree walk: a parent's death does not take its children there, so
 * killing only the launcher's child would leave the run-time loader, the
 * browser CLI and a real Chrome window behind. Elsewhere the Run leads its own
 * process group (`detached: true` at spawn) and a negative pid signals the
 * whole group.
 *
 * The pid is always the one the Console recorded when it started the Run, never
 * an image name: a browser the owner opened by hand is not ours to kill.
 */
export function killProcessTree(pid: number, deps: KillTreeDeps = {}): void {
  const platform = deps.platform ?? process.platform
  if (platform === 'win32') {
    const spawn = deps.spawn ?? defaultSpawn
    // No pipe of our own: this repository's notes record that a piped child is
    // refused in a confined sandbox, and nothing here needs its output.
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.on('error', () => {
      // Nothing to fall back to; the tree was already gone.
    })
    return
  }

  // Wrapped rather than passed as a bare reference: `process.kill` unbound
  // loses its receiver, and the injected form is what a test drives anyway.
  const kill =
    deps.kill ?? ((target: number, signal: NodeJS.Signals) => process.kill(target, signal))
  try {
    kill(-pid, 'SIGTERM')
  } catch {
    // Already gone.
  }
}

/** The refusal a Run already in flight gets, reason included (ADR 0009). */
const BUSY_REASON =
  "a Run is already in flight: the pipeline clears and deletes its one persistent Browser session as its first step, so two concurrent Runs would destroy each other's state"

/**
 * The refusal an Orphaned Run gives a start (#36). Deliberately not the
 * one-at-a-time reason: no Run is *known* to be in flight — the leftover may be
 * a dead Run or one still writing — and there is an action for the owner to
 * take, which the page offers next to the reason.
 */
export const ORPHANED_RUN_REASON =
  'an Orphaned Run is present: its Run log has no Run report and was written recently, so it may still be writing. Clean it up from the page if it is a leftover; a new Run starts after that'

export interface RunStarterDeps {
  launcher: RunLauncher
  /**
   * Whether the newest Run log says a Run is in flight. A Run started from a
   * terminal is as real as one this Console started, and holds the same
   * session — the state comes from the log, never from a handle (ADR 0009).
   */
  isRunInFlight: () => boolean
  /** The names of the global prerequisites this machine is missing (#34 §2). */
  missingPrerequisites: () => readonly string[]
  /**
   * A more specific reason than the one-at-a-time one, or `null` for it (#36).
   * It is what lets an Orphaned Run name the cleanup instead of claiming a Run
   * is in flight, while both refusals stay one `409` in one place.
   */
  busyReason?: () => string | null
}

/**
 * The one-at-a-time rule (spec decision 9; ADR 0009), and the two refusals the
 * page must be able to read: `409` when a Run is already in flight, `412` with
 * the missing prerequisite's name when one is absent.
 *
 * The prerequisites are checked here rather than left to the child so a missing
 * `playwright-cli` or Chrome is a named message; `pwc('close-all')` swallows
 * that failure, so the Run would otherwise die at `pwc('open …')` with the
 * reason buried in stderr.
 */
export function createRunStarter(deps: RunStarterDeps): RunStarter {
  return async (): Promise<RunStartResult> => {
    if (deps.launcher.isAlive() || deps.isRunInFlight()) {
      return { started: false, status: 409, reason: deps.busyReason?.() ?? BUSY_REASON }
    }

    const missing = [...deps.missingPrerequisites()]
    if (missing.length > 0) {
      return {
        started: false,
        status: 412,
        reason: `missing prerequisite${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
        missing,
      }
    }

    deps.launcher.start()
    return { started: true, status: 202, reason: null }
  }
}

export type StopDecision = 'stop-now' | 'confirm'

/**
 * Whether a stop signal has to ask first (ADR 0009; conventions §6).
 *
 * Only a Run in flight is protected. An Orphaned Run is not a life: the Console
 * has no handle for a Run it did not start, so there is no child to take with
 * it and asking would only promise a kill it cannot perform.
 */
export function stopDecision(state: ConsoleRunState): StopDecision {
  return state === 'running' ? 'confirm' : 'stop-now'
}

export interface BrowserSessionCloserDeps {
  /** The pipeline's named Browser session (`SESSION_NAME`, default `bluepoch`). */
  sessionName: string
  /** Injected so a test can assert each platform's own launch shape. */
  platform?: NodeJS.Platform
  /** Injected so a test can assert the argv without launching anything. */
  spawn?: typeof import('node:child_process').spawn
  /** The global CLI on `PATH`; overridable so a test needs no install. */
  command?: string
}

/**
 * Close the Run's persistent Browser session through the global browser CLI —
 * the cleanup's one effect on the machine (#36). It is the same command the
 * pipeline runs as its first step (`npx playwright-cli -s=<session>
 * close-all`), minus `npx`.
 *
 * Why Windows needs `cmd.exe`: npm installs the global CLI as
 * `playwright-cli.cmd`/`.ps1`, and `CreateProcess` cannot start either —
 * measured on this machine, `spawn('playwright-cli', …, { shell: false })` is
 * `ENOENT`, while `cmd /c playwright-cli --version` exits 0. This is the only
 * shell the Console uses, and it carries the two arguments the brief names (no
 * page hash, no quotes, nothing cmd.exe can mangle). The pipeline's own `pwc()`
 * goes through a shell for this exact command too.
 *
 * A failure to launch is swallowed, exactly as the pipeline's own
 * `pwc('close-all')` swallows it: the acknowledgement still has to happen,
 * because the alternative is a page that offers the same cleanup forever.
 */
export function createBrowserSessionCloser(deps: BrowserSessionCloserDeps): () => void {
  const spawn = deps.spawn ?? defaultSpawn
  const platform = deps.platform ?? process.platform
  const command = deps.command ?? 'playwright-cli'
  const args = [`-s=${deps.sessionName}`, 'close-all']

  return () => {
    const [file, argv] =
      platform === 'win32'
        ? ['cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')]]
        : [command, args]
    const child = spawn(file, argv, { stdio: 'ignore', windowsHide: true })
    child.on('error', () => {
      // Nothing to fall back to; the log is the truth either way.
    })
  }
}

export interface RunCleanerDeps {
  /** Whether a Run is in flight — from the Run log, never from a handle. */
  isRunInFlight: () => boolean
  /** `createBrowserSessionCloser`: the leftover session's one cost. */
  closeBrowserSession: () => void
  /** Records, in memory, that the newest log's claim was acknowledged. */
  acknowledgeOrphan: () => void
}

/**
 * Clean an Orphaned Run from the page (spec decision 12; ADR 0009).
 *
 * What it does, and what it deliberately does not:
 *
 *   - It is refused with `409` while a Run is in flight: closing the session
 *     under a live Run would destroy the very state the one-at-a-time rule
 *     protects.
 *   - It closes the leftover Browser session and then **acknowledges** the
 *     log's claim. The acknowledgement is in memory, so a Console restart
 *     re-reports the leftover — the log is still there, and still says what it
 *     always said.
 *   - It never deletes or rewrites a Run log. The log is the audit trail
 *     (ADR 0007) and the Console does not own it: a missing Run report is a
 *     defect in the log, not something to tidy away. Cleaning up removes the
 *     *claim* that a Run may still be writing, not the record that it ran.
 *
 * It is offered, not forced: a recent unfinished log may be a Run that is
 * genuinely still writing, and the two are indistinguishable from the log
 * directory alone (ADR 0009).
 */
export function createRunCleaner(deps: RunCleanerDeps): RunCleaner {
  return async () => {
    if (deps.isRunInFlight()) {
      return { cleaned: false, status: 409, reason: BUSY_REASON }
    }

    deps.closeBrowserSession()
    deps.acknowledgeOrphan()
    return { cleaned: true, status: 200, reason: null }
  }
}
