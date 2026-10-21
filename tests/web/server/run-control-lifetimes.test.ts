// ── Run lifetimes at the process seam (#36) ─────────────────────────
//
// The two process-level behaviours ADR 0009 asks for, tested through the seams
// #34 left injectable: the whole-tree kill (never by image name), the decision
// a signal makes, and the cleanup of a leftover Run. Nothing here spawns a real
// process, and no scrape is run.

import { describe, expect, it } from 'vitest'

import type { RunLauncher } from '../../../web/server/run-control.js'
import {
  createRunCleaner,
  createRunLauncher,
  createRunStarter,
  killProcessTree,
  stopDecision,
} from '../../../web/server/run-control.js'

type Spawn = typeof import('node:child_process').spawn

/** A stand-in `ChildProcess`: records its error listeners, spawns nothing. */
class FakeChild {
  private readonly listeners = new Map<string, (() => void)[]>()

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

interface SpawnCall {
  command: string
  args: readonly string[]
  options: Record<string, unknown>
}

/** A spawner that records what it was asked to launch, and spawns nothing. */
function spawner(child: FakeChild = new FakeChild()): {
  spawn: Spawn
  calls: SpawnCall[]
} {
  const calls: SpawnCall[] = []
  // `spawn` is overloaded and returns a real `ChildProcess`; a fake that only
  // records its arguments cannot be typed into it without an assertion.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const spawn = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ command, args, options })
    return child
  }) as unknown as Spawn
  return { spawn, calls }
}

function launcherWith(
  platform: NodeJS.Platform,
  overrides: Partial<Parameters<typeof createRunLauncher>[0]> = {},
): RunLauncher {
  return createRunLauncher({
    nodePath: 'C:\\nvm4w\\nodejs\\node.exe',
    runEntry: 'C:\\root\\run.js',
    appRoot: 'C:\\root',
    platform,
    ...overrides,
  })
}

describe('stopDecision', () => {
  it('stops at once when no Run is in flight', () => {
    expect(stopDecision('idle')).toBe('stop-now')
  })

  it('stops at once over an orphaned log: a leftover is not a life', () => {
    // Nothing this Console started is alive, and it has no pid to kill anyway.
    expect(stopDecision('orphaned')).toBe('stop-now')
  })

  it('asks before killing a Run in flight', () => {
    expect(stopDecision('running')).toBe('confirm')
  })
})

describe('killProcessTree', () => {
  it('walks the whole tree with taskkill on Windows, and nothing else', () => {
    const { spawn, calls } = spawner()

    killProcessTree(4321, { platform: 'win32', spawn })

    expect(calls).toHaveLength(1)
    const [call] = calls
    // The pid the Console recorded at spawn time — never an image name, which
    // would also kill a process the owner started by hand.
    expect(call.command).toBe('taskkill')
    expect(call.args).toEqual(['/PID', '4321', '/T', '/F'])
    // The notes' rule: no pipe of our own, or a confined host refuses it.
    expect(call.options.stdio).toBe('ignore')
  })

  it('signals the process group elsewhere, where the Run leads one', () => {
    const killed: [number, string][] = []

    killProcessTree(4321, {
      platform: 'linux',
      kill: (pid, signal) => killed.push([pid, signal]),
    })

    expect(killed).toEqual([[-4321, 'SIGTERM']])
  })

  it('treats an already-gone tree as the outcome it asked for', () => {
    expect(() =>
      killProcessTree(4321, {
        platform: 'linux',
        kill: () => {
          throw new Error('ESRCH')
        },
      }),
    ).not.toThrow()
  })

  it('makes the Run its own process group off Windows, and not on it', () => {
    // `process.kill(-pid)` only means "the group" if the child leads one.
    const linux = spawner()
    launcherWith('linux', { spawn: linux.spawn }).start()
    expect(linux.calls[0].options.detached).toBe(true)

    const windows = spawner()
    launcherWith('win32', { spawn: windows.spawn }).start()
    // On Windows the child is not detached: `taskkill /T` does the tree walk.
    expect(windows.calls[0].options.detached).toBe(false)
  })
})

describe('createRunCleaner', () => {
  it('refuses to clean under a Run in flight, and says why', async () => {
    let acknowledged = 0
    const clean = createRunCleaner({
      isRunInFlight: () => true,
      acknowledgeOrphan: () => {
        acknowledged++
      },
    })

    const result = await clean()

    expect(result.cleaned).toBe(false)
    expect(result.status).toBe(409)
    expect(result.refusal).toEqual({ code: 'run-busy', missing: [] })
    // Untouched: cleaning under a live Run would withdraw its claim while it
    // is still writing.
    expect(acknowledged).toBe(0)
  })

  it('acknowledges the orphan when it can', async () => {
    let acknowledged = 0
    const clean = createRunCleaner({
      isRunInFlight: () => false,
      acknowledgeOrphan: () => {
        acknowledged++
      },
    })

    expect(await clean()).toMatchObject({ cleaned: true, status: 200, refusal: null })
    expect(acknowledged).toBe(1)
  })
})

describe('createRunStarter, with an Orphaned Run present', () => {
  /** A launcher with no child of its own: a terminal Run looks the same. */
  const deadLauncher: RunLauncher = {
    start: () => {},
    isAlive: () => false,
    stop: () => {},
  }

  it('refuses the start with the orphaned-run code, not the generic busy one', async () => {
    const startRun = createRunStarter({
      launcher: deadLauncher,
      isRunInFlight: () => true,
      missingPrerequisites: () => [],
      refusalCode: () => 'orphaned-run',
    })

    const result = await startRun()

    expect(result).toMatchObject({ started: false, status: 409 })
    expect(result.refusal).toEqual({ code: 'orphaned-run', missing: [] })
  })

  it('keeps the one-at-a-time code when a Run really is in flight', async () => {
    const startRun = createRunStarter({
      launcher: deadLauncher,
      isRunInFlight: () => true,
      missingPrerequisites: () => [],
      refusalCode: () => null,
    })

    expect((await startRun()).refusal).toEqual({ code: 'run-busy', missing: [] })
  })
})
