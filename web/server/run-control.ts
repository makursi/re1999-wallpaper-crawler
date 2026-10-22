// ── Run control: starting and owning a Run's process ────────────────
//
// A Run is spawned as the current Node binary with the built Run entry as its
// only argument, in the application root — never through a shell, never through
// `npx` or `pnpm` (spec decision 6). #84 removed the transpiler from that argv:
// the entry is `run.js`, a bundle beside the Console's own (`scripts/build.ts`),
// so a packaged tree starts a Run with the Node runtime it already carries and
// nothing under `node_modules`. The root travels in the child's environment
// (`RE1999_APP_ROOT`) as well as in its cwd, so the child receives it as an
// input rather than deriving it (#78).
// The Console adds no pipe of its own: the Run's own children need pipes and a
// confined host refuses a second one, so the child inherits the Console's
// stdout/stderr (`stdio: ['ignore', 'inherit', 'inherit']`). Its output is
// not the Run's truth in any case — the Run log is (ADR 0009).

import { spawn as defaultSpawn } from 'node:child_process'
import process from 'node:process'

import { APP_ROOT_ENV } from '../../core/app-root.js'
import type {
  ConsoleRefusal,
  ConsoleRunState,
  PrerequisiteCode,
  RefusalCode,
} from '../api-types.js'
import type { ExitProgram, RunCleaner, RunStartResult, RunStarter } from './server.js'

export interface RunLauncher {
  /** Spawns the Run and returns at once. Throws when one is already alive. */
  start(): void
  /** `true` while the child this launcher started is still running. */
  isAlive(): boolean
  /**
   * Kills the whole tree the launcher started — the Run and whatever it
   * spawned — because on Windows a parent's death does not take its children
   * (ADR 0009). A no-op when nothing is alive. #36 completes the tree kill; the
   * seam exists here so no caller has to invent one.
   */
  stop(): void
}

export interface RunLauncherDeps {
  /** The current Node binary (`process.execPath`). */
  nodePath: string
  /**
   * `<appRoot>/run.js` — the built Run entry, the sibling of the Console's own
   * (#84; `web/server/build-artifacts.ts` names it). Handed to Node as slot 0
   * of the argv, so the Run needs no loader of its own.
   */
  runEntry: string
  /** The application root: the Run's cwd, and where `.env` and `logs/` live. */
  appRoot: string
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
    const spawned = spawn(deps.nodePath, [deps.runEntry], {
      cwd: deps.appRoot,
      shell: false,
      windowsHide: true,
      // Off Windows the child has to lead its own process group, because that
      // is what `process.kill(-pid)` signals; on Windows `taskkill /T` walks the
      // tree instead, so a detached child would only lose the console's handle
      // on it.
      detached: platform !== 'win32',
      stdio: ['ignore', 'inherit', 'inherit'],
      // The app root is passed down explicitly (#78): the Run never has to
      // derive it, and the Console's own resolution — environment or source
      // fallback — is the only one that happens.
      env: { ...process.env, [APP_ROOT_ENV]: deps.appRoot },
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
 * killing only the launcher's child could leave anything the Run spawned behind.
 * Elsewhere the Run leads its own process group (`detached: true` at spawn) and
 * a negative pid signals the whole group.
 *
 * The pid is always the one the Console recorded when it started the Run, never
 * an image name: a process the owner started by hand is not ours to kill.
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

/**
 * A refusal, as the contract carries it: a stable code and its parameters. The
 * service never writes the sentence — the page does, in the reader's language
 * (#47, docs/adr/0014).
 */
function refusal(code: RefusalCode, missing: PrerequisiteCode[] = []): ConsoleRefusal {
  return { code, missing }
}

export interface RunStarterDeps {
  launcher: RunLauncher
  /**
   * Whether the newest Run log says a Run is in flight. A Run started from a
   * terminal is as real as one this Console started, and writes the same Mirror
   * and log directory — the state comes from the log, never from a handle
   * (ADR 0009).
   */
  isRunInFlight: () => boolean
  /** The codes of the global prerequisites this machine is missing (#34 §2). */
  missingPrerequisites: () => readonly PrerequisiteCode[]
  /**
   * A more specific code than the one-at-a-time one, or `null` for it (#36).
   * It is what lets an Orphaned Run name the cleanup instead of claiming a Run
   * is in flight, while both refusals stay one `409` in one place.
   */
  refusalCode?: () => RefusalCode | null
}

/**
 * The one-at-a-time rule (spec decision 9; ADR 0009), and the two refusals the
 * page must be able to read: `409` with `run-busy` (or `orphaned-run`) when a
 * Run is already in flight, `412` with `missing-prerequisite` and the missing
 * prerequisites' codes when one is absent.
 *
 * The prerequisites are checked here rather than left to the child so an
 * unusable configuration is a named code; otherwise the package fails a Run at
 * its eager parse with a `ZodError` buried in the Console's stderr. The built
 * Run entry is not one of them: it is a build artifact, and a tree without one
 * refuses at boot (`web/server/build-artifacts.ts`), before a port is bound.
 */
export function createRunStarter(deps: RunStarterDeps): RunStarter {
  return async (): Promise<RunStartResult> => {
    if (deps.launcher.isAlive() || deps.isRunInFlight()) {
      return { started: false, status: 409, refusal: refusal(deps.refusalCode?.() ?? 'run-busy') }
    }

    const missing = [...deps.missingPrerequisites()]
    if (missing.length > 0) {
      return { started: false, status: 412, refusal: refusal('missing-prerequisite', missing) }
    }

    deps.launcher.start()
    return { started: true, status: 202, refusal: null }
  }
}

/**
 * The HTTP status a start's answer carries (spec decision 9).
 *
 * Here, next to the rule that decides the answer, and not in the route: which
 * code a refusal deserves is a judgement about the Console's state, and the
 * transport only relays it. Every real answer already names its own `status`;
 * this is the answer for a caller that supplies none — an unstaged start is a
 * refusal (409), never an acceptance.
 */
export function startStatusOf(answer: { started: boolean; status?: number }): number {
  return answer.status ?? (answer.started ? 202 : 409)
}

/**
 * The HTTP status a cleanup's answer carries. Same reasoning as
 * `startStatusOf`: a cleanup that did not clean was refused (409).
 */
export function cleanupStatusOf(answer: { cleaned: boolean; status?: number }): number {
  return answer.status ?? (answer.cleaned ? 200 : 409)
}

export type StopDecision = 'stop-now' | 'confirm'

/** The exit's own pure decision (#96): leave now, or ask the caller first. */
export type ExitDecision = 'exit-at-once' | 'refuse-confirm'

/**
 * The page's exit, sharing the terminal signal's one rule (#96, ADR 0022).
 *
 * A Run in flight asks first — that arm is `stopDecision`, not a second rule —
 * and every other state leaves at once: an Orphaned Run is not a life, and the
 * Console has no child to take with it. `confirmed` is the caller's answer to
 * that question, so an unconfirmed exit in flight is refused here and nowhere
 * else.
 */
export function exitDecisionOf(state: ConsoleRunState, confirmed: boolean): ExitDecision {
  return stopDecision(state) === 'confirm' && !confirmed ? 'refuse-confirm' : 'exit-at-once'
}

/**
 * What the exit knew when it was permitted, for the composition root's Chinese
 * lines: whether a Run was in flight, and whether this Console owned the child
 * whose tree it killed.
 */
export interface ExitOutcome {
  /** The newest Run log said a Run was in flight when the exit was permitted. */
  runInFlight: boolean
  /** This Console had its own child, and therefore killed its tree. */
  killedOwnRun: boolean
}

export interface ExitControllerDeps {
  /** The Run state from the Run log directory — never from a handle. */
  runState: () => ConsoleRunState
  /** The launcher whose child is the only tree this Console may kill. */
  launcher: RunLauncher
  /**
   * The composition root's shutdown: close the service, print the Chinese
   * lines, `process.exit(0)`. Scheduled after the HTTP answer is written.
   */
  shutdown: (outcome: ExitOutcome) => void
  /**
   * Schedules the shutdown. The default is a short timer, so the `202` reaches
   * the page before the process begins to tear down (#96).
   */
  schedule?: (run: () => void) => void
}

/** How long the HTTP answer gets before the shutdown starts. */
const EXIT_ANSWER_GRACE_MS = 50

/**
 * The page's exit action (#96), at its unit seam.
 *
 * The controller owns the whole decision and the kill — the pure rule, the
 * ownership check, and `launcher.stop()` for the tree this Console started — and
 * hands the composition root only what it cannot know: an outcome to say in
 * Chinese. A Run that lives in a terminal has no handle here, so it is reported
 * as "only the service stops" rather than pretended dead. The shutdown is
 * scheduled, never run inline, so the page's `202` is written first; and a
 * second permitted call cannot schedule it twice.
 */
export function createExitController(deps: ExitControllerDeps): ExitProgram {
  const schedule = deps.schedule ?? ((run: () => void) => setTimeout(run, EXIT_ANSWER_GRACE_MS))
  let permitted = false

  return confirmed => {
    // Already going down: answer the same thing, and do not schedule a second
    // shutdown. A double-click on Exit must not race the first one.
    if (permitted) return { exiting: true }

    const state = deps.runState()
    if (exitDecisionOf(state, confirmed) === 'refuse-confirm') {
      return { exiting: false, refusal: refusal('exit-confirm-required') }
    }

    permitted = true
    // Only the child this Console started is ours to kill. A terminal Run has
    // no pid here, and killing by image name would reach a process the owner
    // started (ADR 0009).
    const killedOwnRun = deps.launcher.isAlive()
    if (killedOwnRun) deps.launcher.stop()
    const outcome: ExitOutcome = { runInFlight: state === 'running', killedOwnRun }
    schedule(() => deps.shutdown(outcome))
    // The accepted answer is exactly `{"exiting": true}` (spec #93): there is no
    // refusal field to explain an exit that was permitted.
    return { exiting: true }
  }
}

/**
 * The HTTP status an exit's answer carries: accepted (202) or refused (409).
 * Same reasoning as `startStatusOf` — the module that owns the decision names
 * the status, and the route only writes it.
 */
export function exitStatusOf(answer: { exiting: boolean; status?: number }): number {
  return answer.status ?? (answer.exiting ? 202 : 409)
}

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

export interface RunCleanerDeps {
  /** Whether a Run is in flight — from the Run log, never from a handle. */
  isRunInFlight: () => boolean
  /** Records, in memory, that the newest log's claim was acknowledged. */
  acknowledgeOrphan: () => void
}

/**
 * Clean an Orphaned Run from the page (spec decision 12; ADR 0009).
 *
 * What it does, and what it deliberately does not:
 *
 *   - It is refused with `409` while a Run is in flight: acknowledging a log
 *     that a live Run is still writing would destroy the state the
 *     one-at-a-time rule protects.
 *   - It **acknowledges** the log's claim. The acknowledgement is in memory, so
 *     a Console restart re-reports the leftover — the log is still there, and
 *     still says what it always said. #76 removed the browser session the old
 *     cleanup also closed; a Run no longer opens one.
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
      return { cleaned: false, status: 409, refusal: refusal('run-busy') }
    }

    deps.acknowledgeOrphan()
    return { cleaned: true, status: 200, refusal: null }
  }
}
