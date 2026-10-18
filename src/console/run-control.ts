// ── Run control: starting and owning a Run's process ────────────────
//
// A Run is spawned as the current Node binary with the tsx entry as its first
// argument, in the repository root — never through a shell, never through `npx`
// or `pnpm` (spec decision 6; .console-notes/01-run-contract-and-mirror.md §6.1).
// The Console adds no pipe of its own: the Run's own children need pipes and a
// confined host refuses a second one, so the child inherits the Console's
// stdout/stderr (`stdio: ['ignore', 'inherit', 'inherit']`, §6.3). Its output is
// not the Run's truth in any case — the Run log is (ADR 0009).

import { spawn as defaultSpawn } from 'node:child_process'
import process from 'node:process'

import type { RunStartResult, RunStarter } from './server.js'

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
  /** `<root>/src/main.ts` — the same entry `pnpm save-wallpapers` runs. */
  mainEntry: string
  /** The repository root: the Run's cwd, and where `.env` and `logs/` live. */
  projectRoot: string
  /** Injected so a test can watch the argv without spawning anything. */
  spawn?: typeof import('node:child_process').spawn
  /** Injected so a test can assert the tree kill without killing anything. */
  killTree?: (pid: number) => void
}

/**
 * The launcher seam (spec decision 6; .console-notes/00-conventions.md §6).
 *
 * The child is never `npx` and never a shell: on Windows both are `.cmd`/`.ps1`
 * shims that need `shell: true`, and cmd.exe mangles the arguments a launcher
 * like that would pass (AGENTS.md). `env` is the Console's own environment, so
 * the Run sees the same machine.
 */
export function createRunLauncher(deps: RunLauncherDeps): RunLauncher {
  const spawn = deps.spawn ?? defaultSpawn
  const killTree = deps.killTree ?? killProcessTree
  let child: ReturnType<typeof spawn> | null = null
  let alive = false

  function start(): void {
    if (alive) throw new Error('a Run is already in flight')
    const spawned = spawn(deps.nodePath, [deps.tsxEntry, deps.mainEntry], {
      cwd: deps.projectRoot,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,
    })
    child = spawned
    alive = true
    spawned.on('exit', () => {
      alive = false
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

/**
 * The whole-tree kill's default. `taskkill /T` is Windows' own tree walk; on
 * other platforms the Run is expected to be its own process group, so a
 * negative pid signals the group. Errors are swallowed: a tree that is already
 * gone is the outcome this asks for. #36 owns the confirmation that guards it.
 */
function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    const killer = defaultSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.on('error', () => {
      // Nothing to fall back to; the pid was already gone.
    })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    // Already gone.
  }
}

/** The refusal a Run already in flight gets, reason included (ADR 0009). */
const BUSY_REASON =
  "a Run is already in flight: the pipeline clears and deletes its one persistent Browser session as its first step, so two concurrent Runs would destroy each other's state"

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
}

/**
 * The one-at-a-time rule (spec decision 9; ADR 0009), and the two refusals the
 * page must be able to read: `409` when a Run is already in flight, `412` with
 * the missing prerequisite's name when one is absent.
 *
 * The prerequisites are checked here rather than left to the child so a missing
 * `playwright-cli` or Chrome is a named message; `pwc('close-all')` swallows
 * that failure, so the Run would otherwise die at `pwc('open …')` with the
 * reason buried in stderr (.console-notes/01 §5.1).
 */
export function createRunStarter(deps: RunStarterDeps): RunStarter {
  return async (): Promise<RunStartResult> => {
    if (deps.launcher.isAlive() || deps.isRunInFlight()) {
      return { started: false, status: 409, reason: BUSY_REASON }
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
