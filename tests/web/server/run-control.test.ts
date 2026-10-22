import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { APP_ROOT_ENV } from '../../../core/app-root.js'
import type { ConsoleRunState } from '../../../web/api-types.js'
import { runEntryPath } from '../../../web/server/build-artifacts.js'
import type { PrerequisiteChecks } from '../../../web/server/prerequisites.js'
import { missingPrerequisites } from '../../../web/server/prerequisites.js'
import type { ExitOutcome, RunLauncher } from '../../../web/server/run-control.js'
import {
  createExitController,
  createRunLauncher,
  createRunStarter,
  exitDecisionOf,
  exitStatusOf,
} from '../../../web/server/run-control.js'

type Spawn = typeof import('node:child_process').spawn

/**
 * A stand-in for `ChildProcess` that carries a pid and lets the test drive its
 * exit — the launcher's whole life is what those two things say.
 */
class FakeChild {
  readonly pid: number
  private readonly listeners = new Map<string, (() => void)[]>()

  constructor(pid = 4321) {
    this.pid = pid
  }

  on(event: string, listener: () => void): this {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }
}

/** The recorded spawn call, so a test can assert the argv the Run really gets. */
function spawner(child: FakeChild): {
  spawn: Spawn
  calls: [string, readonly string[], Record<string, unknown>][]
} {
  const calls: [string, readonly string[], Record<string, unknown>][] = []
  // `spawn` is overloaded and returns a real `ChildProcess`; a fake that only
  // records its arguments cannot be typed into it without an assertion.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const spawn = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push([command, args, options])
    return child
  }) as unknown as Spawn
  return { spawn, calls }
}

/**
 * A launcher that records the starts it was asked for and nothing else.
 * `starts()` is read, not a field, so a refusal can be asserted to start nothing.
 */
function countingLauncher(alive: boolean): { launcher: RunLauncher; starts: () => number } {
  let starts = 0
  const launcher: RunLauncher = {
    start: () => {
      starts++
    },
    isAlive: () => alive,
    stop: () => {},
  }
  return { launcher, starts: () => starts }
}

function launcherWith(
  overrides: Partial<Parameters<typeof createRunLauncher>[0]> = {},
): RunLauncher {
  return createRunLauncher({
    nodePath: 'C:\\nvm4w\\nodejs\\node.exe',
    runEntry: runEntryPath('C:\\root'),
    appRoot: 'C:\\root',
    ...overrides,
  })
}

/** Every global prerequisite satisfied, as a machine with them all looks. */
const ALL_PRESENT: PrerequisiteChecks = {
  envFile: () => true,
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('missingPrerequisites', () => {
  /** A temporary packaged layout: `app/.env` and/or `data/user.env`, both optional. */
  function installationWith(files: { app?: string | null; user?: string | null }): {
    appRoot: string
    dataRoot: string
  } {
    const install = fs.mkdtempSync(path.join(os.tmpdir(), 'prerequisites-'))
    roots.push(install)
    const appRoot = path.join(install, 'app')
    const dataRoot = path.join(install, 'data')
    fs.mkdirSync(appRoot)
    fs.mkdirSync(dataRoot)
    if (files.app != null) fs.writeFileSync(path.join(appRoot, '.env'), files.app, 'utf8')
    if (files.user != null) fs.writeFileSync(path.join(dataRoot, 'user.env'), files.user, 'utf8')
    return { appRoot, dataRoot }
  }

  const requiredLines = 'BASE_ORIGIN=https://re.bluepoch.com'

  it('names the configuration when it is absent', () => {
    const missing = missingPrerequisites({
      appRoot: 'C:\\root',
      checks: { envFile: () => false },
    })

    expect(missing).toEqual(['env-file'])
  })

  it('names nothing when the machine has what a Run needs', () => {
    expect(missingPrerequisites({ appRoot: 'C:\\root', checks: ALL_PRESENT })).toEqual([])
  })

  it('accepts a valid app .env file', () => {
    const { appRoot, dataRoot } = installationWith({ app: requiredLines })

    expect(missingPrerequisites({ appRoot, dataRoot, env: {} })).toEqual([])
  })

  it('refuses a .env whose defaulted value the Run would reject', () => {
    // The two required keys are present; `BATCH_SIZE=abc` fails the full schema
    // the Run parses, so the start refuses what the setup notice warns about.
    const { appRoot, dataRoot } = installationWith({
      app: `${requiredLines}\nBATCH_SIZE=abc`,
    })

    expect(missingPrerequisites({ appRoot, dataRoot, env: {} })).toEqual(['env-file'])
  })

  it('accepts the user layer as the source of the required keys', () => {
    // The same merged schema the Run parses decides usability; the user layer is
    // a real layer, not a decoration on the app layer (#78).
    const { appRoot, dataRoot } = installationWith({ user: requiredLines })

    expect(missingPrerequisites({ appRoot, dataRoot, env: {} })).toEqual([])
  })

  it('refuses when a user override makes the layered configuration unusable', () => {
    const { appRoot, dataRoot } = installationWith({
      app: requiredLines,
      user: 'BATCH_SIZE=abc',
    })

    expect(missingPrerequisites({ appRoot, dataRoot, env: {} })).toEqual(['env-file'])
  })
})

describe('createRunStarter', () => {
  it('starts exactly one Run when nothing is in flight and nothing is missing', async () => {
    const bound = countingLauncher(false)
    const starter = createRunStarter({
      launcher: bound.launcher,
      isRunInFlight: () => false,
      missingPrerequisites: () => [],
    })

    const result = await starter()

    expect(result.started).toBe(true)
    expect(result.status).toBe(202)
    expect(result.refusal).toBeNull()
    expect(bound.starts()).toBe(1)
  })

  it('refuses a second start while a Run lives, with the run-busy code', async () => {
    const bound = countingLauncher(true)
    const starter = createRunStarter({
      launcher: bound.launcher,
      isRunInFlight: () => false,
      missingPrerequisites: () => [],
    })

    const result = await starter()

    expect(result.started).toBe(false)
    expect(result.status).toBe(409)
    // The one-at-a-time rule, as a code: the page owns the sentence.
    expect(result.refusal).toEqual({ code: 'run-busy', missing: [] })
    expect(bound.starts()).toBe(0)
  })

  it('refuses while the log says a Run is in flight, with no child of ours', async () => {
    // A Run started from a terminal holds the same persistent Browser session.
    const bound = countingLauncher(false)
    const starter = createRunStarter({
      launcher: bound.launcher,
      isRunInFlight: () => true,
      missingPrerequisites: () => [],
    })

    const result = await starter()

    expect(result.status).toBe(409)
    expect(result.refusal).toEqual({ code: 'run-busy', missing: [] })
    expect(bound.starts()).toBe(0)
  })

  it('names every missing prerequisite as a code and starts nothing', async () => {
    const bound = countingLauncher(false)
    const starter = createRunStarter({
      launcher: bound.launcher,
      isRunInFlight: () => false,
      missingPrerequisites: () => ['env-file'],
    })

    const result = await starter()

    expect(result.started).toBe(false)
    expect(result.status).toBe(412)
    expect(result.refusal).toEqual({
      code: 'missing-prerequisite',
      missing: ['env-file'],
    })
    expect(bound.starts()).toBe(0)
  })

  it('reports a Run in flight ahead of a missing prerequisite', async () => {
    const bound = countingLauncher(true)
    const starter = createRunStarter({
      launcher: bound.launcher,
      isRunInFlight: () => false,
      missingPrerequisites: () => ['env-file'],
    })

    expect((await starter()).status).toBe(409)
  })
})

/**
 * The page's exit (#96), at its own seam: the pure decision and the controller
 * with its launcher and shutdown injected. The composition root — the Chinese
 * lines, the real `service.close()` and `process.exit(0)` — is glue, verified by
 * booting the built tree; what is decided here is what the tests own.
 */
describe('exitDecisionOf', () => {
  it('lets an idle exit stop at once, with or without a confirmation', () => {
    expect(exitDecisionOf('idle', false)).toBe('exit-at-once')
    expect(exitDecisionOf('idle', true)).toBe('exit-at-once')
  })

  it('asks before leaving while a Run is in flight, and honours the confirmation', () => {
    // The same `stopDecision` the terminal signal uses: one rule, two doors.
    expect(exitDecisionOf('running', false)).toBe('refuse-confirm')
    expect(exitDecisionOf('running', true)).toBe('exit-at-once')
  })

  it('treats an Orphaned Run like an idle one: there is no child to take with it', () => {
    expect(exitDecisionOf('orphaned', false)).toBe('exit-at-once')
  })
})

/** A launcher whose `stop` is counted, so "killed the tree" is observable. */
function exitHarness(
  state: ConsoleRunState,
  alive: boolean,
): {
  exit: ReturnType<typeof createExitController>
  shutdowns: ExitOutcome[]
  kills: () => number
} {
  let live = alive
  let kills = 0
  const shutdowns: ExitOutcome[] = []
  const launcher: RunLauncher = {
    start: () => {},
    isAlive: () => live,
    stop: () => {
      kills++
      live = false
    },
  }
  const exit = createExitController({
    runState: () => state,
    launcher,
    shutdown: outcome => shutdowns.push(outcome),
    // The real one is a short timer so the HTTP answer is written first; a unit
    // test needs the order only, so the shutdown runs now.
    schedule: run => run(),
  })
  return { exit, shutdowns, kills: () => kills }
}

describe('createExitController', () => {
  it('lets an idle exit go at once, and closes the service exactly once', () => {
    const harness = exitHarness('idle', false)

    expect(harness.exit(false)).toEqual({ exiting: true, refusal: null })

    expect(harness.shutdowns).toEqual([{ runInFlight: false, killedOwnRun: false }])
    expect(harness.kills()).toBe(0)
  })

  it('refuses an unconfirmed exit while a Run is in flight, and stops nothing', () => {
    const harness = exitHarness('running', false)

    expect(harness.exit(false)).toEqual({
      exiting: false,
      refusal: { code: 'exit-confirm-required', missing: [] },
    })

    expect(harness.shutdowns).toEqual([])
    expect(harness.kills()).toBe(0)
  })

  it('kills the whole tree it started when the exit is confirmed, once', () => {
    const harness = exitHarness('running', true)

    expect(harness.exit(true)).toEqual({ exiting: true, refusal: null })

    expect(harness.kills()).toBe(1)
    expect(harness.shutdowns).toEqual([{ runInFlight: true, killedOwnRun: true }])
  })

  it('reports a Run it did not start as the service stopping only', () => {
    // A terminal Run has no handle here: the service goes, the Run may keep
    // writing, and the outcome says so rather than claiming a kill.
    const harness = exitHarness('running', false)

    harness.exit(true)

    expect(harness.kills()).toBe(0)
    expect(harness.shutdowns).toEqual([{ runInFlight: true, killedOwnRun: false }])
  })

  it('answers a repeated permitted exit without scheduling a second shutdown', () => {
    const harness = exitHarness('idle', false)

    expect(harness.exit(false)).toEqual({ exiting: true, refusal: null })
    expect(harness.exit(true)).toEqual({ exiting: true, refusal: null })

    expect(harness.shutdowns).toHaveLength(1)
  })
})

describe('exitStatusOf', () => {
  it('answers 202 for an exit it accepted and 409 for a refusal', () => {
    expect(exitStatusOf({ exiting: true })).toBe(202)
    expect(exitStatusOf({ exiting: false })).toBe(409)
  })
})

describe('createRunLauncher', () => {
  it('starts the Run as the current Node binary with the built Run entry, in the app root', () => {
    const child = new FakeChild()
    const { spawn, calls } = spawner(child)
    const launcher = launcherWith({ spawn })

    launcher.start()

    expect(calls).toHaveLength(1)
    const [command, args, options] = calls[0]
    expect(command).toBe('C:\\nvm4w\\nodejs\\node.exe')
    // One argument: the built entry. The tsx CLI used to sit in slot 0 and the
    // `.ts` source in slot 1 (#84); a packaged tree has neither.
    expect(args).toEqual([path.join('C:\\root', 'run.js')])
    expect(options.cwd).toBe('C:\\root')
    // Never a shell, never `npx`, never `pnpm` (spec decision 6).
    expect(options.shell).toBe(false)
    expect(options.windowsHide).toBe(true)
  })

  it('loads the Run through nothing in node_modules — the shipped tree has none', () => {
    const child = new FakeChild()
    const { spawn, calls } = spawner(child)

    launcherWith({ spawn }).start()

    const [, args] = calls[0]
    // Neither a tsx loader nor a bundled path: the only argument is a file
    // beside the Console entry, which is what `scripts/build.ts` writes.
    expect(args.some(arg => arg.includes('node_modules'))).toBe(false)
    expect(args.some(arg => /tsx|\.mjs$/.test(arg))).toBe(false)
    expect(args.every(arg => !arg.endsWith('.ts'))).toBe(true)
  })

  it('adds no pipe of the Console\u2019s own to the child, and hands it the app root', () => {
    const child = new FakeChild()
    const { spawn, calls } = spawner(child)

    launcherWith({ spawn }).start()

    const options = calls[0][2]
    expect(options.stdio).toEqual(['ignore', 'inherit', 'inherit'])
    // The child inherits the Console's machine, but the root is passed down
    // explicitly: the Run never has to guess where it was installed.
    expect(options.env).toMatchObject({
      [APP_ROOT_ENV]: 'C:\\root',
      PATH: process.env.PATH,
    })
  })

  it('reads a live child as alive and a child that exited as dead', () => {
    const child = new FakeChild()
    const { spawn } = spawner(child)
    const launcher = launcherWith({ spawn })

    launcher.start()
    expect(launcher.isAlive()).toBe(true)

    child.emit('exit')
    expect(launcher.isAlive()).toBe(false)
  })

  it('refuses a second start while one life lives, and starts nothing', () => {
    const child = new FakeChild()
    const { spawn, calls } = spawner(child)
    const launcher = launcherWith({ spawn })

    launcher.start()

    expect(() => launcher.start()).toThrow(/already/i)
    expect(calls).toHaveLength(1)
  })

  it('starts again after the previous child has exited', () => {
    const child = new FakeChild()
    const { spawn, calls } = spawner(child)
    const launcher = launcherWith({ spawn })

    launcher.start()
    child.emit('exit')
    launcher.start()

    expect(calls).toHaveLength(2)
    expect(launcher.isAlive()).toBe(true)
  })

  it('stops the whole tree of the pid it started, once', () => {
    const child = new FakeChild(9001)
    const { spawn } = spawner(child)
    const killed: number[] = []
    const launcher = launcherWith({ spawn, killTree: pid => killed.push(pid) })

    launcher.start()
    launcher.stop()

    expect(killed).toEqual([9001])
    expect(launcher.isAlive()).toBe(false)

    // Stopping again is a no-op: there is no tree left to kill.
    launcher.stop()
    expect(killed).toEqual([9001])
  })
})
