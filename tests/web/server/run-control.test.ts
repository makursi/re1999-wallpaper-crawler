import * as path from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import type { PrerequisiteChecks } from '../../../web/server/prerequisites.js'
import { missingPrerequisites } from '../../../web/server/prerequisites.js'
import type { RunLauncher } from '../../../web/server/run-control.js'
import { createRunLauncher, createRunStarter } from '../../../web/server/run-control.js'

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
    tsxEntry: path.join('C:\\root', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    mainEntry: path.join('C:\\root', 'core', 'main.ts'),
    projectRoot: 'C:\\root',
    ...overrides,
  })
}

/** Every global prerequisite satisfied, as a machine with them all looks. */
const ALL_PRESENT: PrerequisiteChecks = {
  playwrightCli: () => true,
  chrome: () => true,
  envFile: () => true,
  tsxEntry: () => true,
}

describe('missingPrerequisites', () => {
  it('names what is absent, in the order the notes list it', () => {
    const missing = missingPrerequisites({
      projectRoot: 'C:\\root',
      checks: { ...ALL_PRESENT, playwrightCli: () => false, tsxEntry: () => false },
    })

    expect(missing).toEqual(['playwright-cli', 'tsx entry'])
  })

  it('names the whole gap rather than the first thing it finds', () => {
    const missing = missingPrerequisites({
      projectRoot: 'C:\\root',
      checks: {
        playwrightCli: () => false,
        chrome: () => false,
        envFile: () => false,
        tsxEntry: () => false,
      },
    })

    expect(missing).toEqual(['playwright-cli', 'chrome', '.env', 'tsx entry'])
  })

  it('names nothing when the machine has all four', () => {
    expect(missingPrerequisites({ projectRoot: 'C:\\root', checks: ALL_PRESENT })).toEqual([])
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
    expect(bound.starts()).toBe(1)
  })

  it('refuses a second start while a Run lives, and states why', async () => {
    const bound = countingLauncher(true)
    const starter = createRunStarter({
      launcher: bound.launcher,
      isRunInFlight: () => false,
      missingPrerequisites: () => [],
    })

    const result = await starter()

    expect(result.started).toBe(false)
    expect(result.status).toBe(409)
    // The reason the pipeline insists on: one persistent Browser session.
    expect(result.reason).toMatch(/already in flight/i)
    expect(result.reason).toMatch(/session/i)
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
    expect(bound.starts()).toBe(0)
  })

  it('names every missing prerequisite and starts nothing', async () => {
    const bound = countingLauncher(false)
    const starter = createRunStarter({
      launcher: bound.launcher,
      isRunInFlight: () => false,
      missingPrerequisites: () => ['chrome', 'tsx entry'],
    })

    const result = await starter()

    expect(result.started).toBe(false)
    expect(result.status).toBe(412)
    expect(result.reason).toContain('chrome')
    expect(result.reason).toContain('tsx entry')
    expect(result.missing).toEqual(['chrome', 'tsx entry'])
    expect(bound.starts()).toBe(0)
  })

  it('reports a Run in flight ahead of a missing prerequisite', async () => {
    const bound = countingLauncher(true)
    const starter = createRunStarter({
      launcher: bound.launcher,
      isRunInFlight: () => false,
      missingPrerequisites: () => ['chrome'],
    })

    expect((await starter()).status).toBe(409)
  })
})

describe('createRunLauncher', () => {
  it('starts the Run as the current Node binary with the tsx entry, in the repo root', () => {
    const child = new FakeChild()
    const { spawn, calls } = spawner(child)
    const launcher = launcherWith({ spawn })

    launcher.start()

    expect(calls).toHaveLength(1)
    const [command, args, options] = calls[0]
    expect(command).toBe('C:\\nvm4w\\nodejs\\node.exe')
    expect(args).toEqual([
      path.join('C:\\root', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join('C:\\root', 'core', 'main.ts'),
    ])
    expect(options.cwd).toBe('C:\\root')
    // Never a shell, never `npx`, never `pnpm` (spec decision 6).
    expect(options.shell).toBe(false)
    expect(options.windowsHide).toBe(true)
  })

  it('adds no pipe of the Console\u2019s own to the child', () => {
    const child = new FakeChild()
    const { spawn, calls } = spawner(child)

    launcherWith({ spawn }).start()

    const options = calls[0][2]
    expect(options.stdio).toEqual(['ignore', 'inherit', 'inherit'])
    expect(options.env).toBe(process.env)
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
