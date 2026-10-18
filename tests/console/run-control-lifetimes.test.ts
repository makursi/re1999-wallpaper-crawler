// ── Run lifetimes at the process seam (#36) ─────────────────────────
//
// The two process-level behaviours ADR 0009 asks for, tested through the seams
// #34 left injectable: the whole-tree kill (never by image name), the decision
// a signal makes, and the cleanup of a leftover Run. Nothing here spawns a real
// process, and no scrape is run.

import { describe, expect, it } from 'vitest'

import type { RunLauncher } from '../../src/console/run-control.js'
import {
  createBrowserSessionCloser,
  createRunCleaner,
  createRunLauncher,
  createRunStarter,
  killProcessTree,
  stopDecision,
} from '../../src/console/run-control.js'

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
    tsxEntry: 'C:\\root\\node_modules\\tsx\\dist\\cli.mjs',
    mainEntry: 'C:\\root\\src\\main.ts',
    projectRoot: 'C:\\root',
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
    // would also kill a Chrome the owner opened by hand.
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

describe('createBrowserSessionCloser', () => {
  it('runs the CLI directly where it is a program', () => {
    const { spawn, calls } = spawner()

    createBrowserSessionCloser({ sessionName: 'bluepoch', platform: 'linux', spawn })()

    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('playwright-cli')
    // The same named session the pipeline reuses (src/config.ts › SESSION).
    expect(calls[0].args).toEqual(['-s=bluepoch', 'close-all'])
    expect(calls[0].options.stdio).toBe('ignore')
  })

  it('goes through cmd.exe on Windows, where the global CLI is a .cmd shim', () => {
    const { spawn, calls } = spawner()

    // Measured on this machine: `spawn('playwright-cli', …, {shell: false})` is
    // ENOENT, because npm installs `playwright-cli.cmd`/`.ps1`, which
    // CreateProcess cannot start. The command is unchanged; only its launcher is.
    createBrowserSessionCloser({ sessionName: 'bluepoch', platform: 'win32', spawn })()

    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('cmd.exe')
    expect(calls[0].args).toEqual(['/d', '/s', '/c', 'playwright-cli -s=bluepoch close-all'])
    expect(calls[0].options.stdio).toBe('ignore')
  })

  it('stays quiet when the CLI cannot be launched: the log is the truth', () => {
    const child = new FakeChild()
    const { spawn } = spawner(child)
    const close = createBrowserSessionCloser({ sessionName: 'bluepoch', platform: 'linux', spawn })

    expect(() => close()).not.toThrow()
    expect(() => child.emit('error')).not.toThrow()
  })
})

describe('createRunCleaner', () => {
  it('refuses to clean under a Run in flight, and says why', async () => {
    let closed = 0
    let acknowledged = 0
    const clean = createRunCleaner({
      isRunInFlight: () => true,
      closeBrowserSession: () => {
        closed++
      },
      acknowledgeOrphan: () => {
        acknowledged++
      },
    })

    const result = await clean()

    expect(result.cleaned).toBe(false)
    expect(result.status).toBe(409)
    expect(result.reason).toMatch(/already in flight/i)
    // Untouched: cleaning under a live Run would close its Browser session.
    expect(closed).toBe(0)
    expect(acknowledged).toBe(0)
  })

  it('closes the leftover session and acknowledges the orphan when it can', async () => {
    let closed = 0
    let acknowledged = 0
    const clean = createRunCleaner({
      isRunInFlight: () => false,
      closeBrowserSession: () => {
        closed++
      },
      acknowledgeOrphan: () => {
        acknowledged++
      },
    })

    expect(await clean()).toMatchObject({ cleaned: true, status: 200, reason: null })
    expect(closed).toBe(1)
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

  it('refuses the start with the cleanup named, not the generic busy reason', async () => {
    const startRun = createRunStarter({
      launcher: deadLauncher,
      isRunInFlight: () => true,
      missingPrerequisites: () => [],
      busyReason: () => 'An Orphaned Run is present: clean it up from the page first.',
    })

    const result = await startRun()

    expect(result).toMatchObject({ started: false, status: 409 })
    expect(result.reason).toMatch(/Orphaned Run/)
    expect(result.reason).toMatch(/clean/i)
  })

  it('keeps the one-at-a-time reason when a Run really is in flight', async () => {
    const startRun = createRunStarter({
      launcher: deadLauncher,
      isRunInFlight: () => true,
      missingPrerequisites: () => [],
      busyReason: () => null,
    })

    expect((await startRun()).reason).toMatch(/already in flight/i)
  })
})
