// ── The page's one exit, as state (#96) ─────────────────────────────
//
// The composable's world is two seams: the one request the page makes
// (`lib/console-api.ts`) and the status store it halts after an accepted exit.
// This file mocks exactly those two, so the real state machine runs in a node
// environment with no DOM and no network — and the confirmation flow can be
// driven from the service's two answers instead of from a browser.
//
// The composable is loaded through a variable specifier on purpose: the root
// type program has no DOM lib and excludes `web/src`, while this test has to
// reach a page module. The shape below is the slice this test drives, declared
// structurally so the check stays on the behaviour rather than on the page's
// import graph.
//
// The regression pinned here is the stale `interruptedRun`: the 409 used to set
// it for good, so "Keep running" followed by a later idle exit still told the
// reader the Run log was truncated. The flag belongs to the exit that is
// actually happening, and only that one.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConsoleExitPayload } from '../../../../web/api-types.js'

const mocks = vi.hoisted(() => ({
  postJson: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
  halt: vi.fn<() => void>(),
}))

vi.mock('../../../../web/src/lib/console-api.js', () => ({ postJson: mocks.postJson }))
vi.mock('../../../../web/src/composables/useConsoleStatus.js', () => ({
  useConsoleStatus: () => ({ halt: mocks.halt }),
}))
// The refusal copy is the dictionary's, and loading it installs a document
// effect; the state machine under test only needs the three functions.
vi.mock('../../../../web/src/i18n/refusal.js', () => ({
  refusalFromError: (error: unknown) => ({ kind: 'error', message: String(error) }),
  refusalOf: (status: number) => ({ kind: 'status', status }),
  refusalTextOf: () => null,
}))

/** The slice of the composable's store this test drives. */
interface ExitStore {
  interruptedRun: { value: boolean }
  awaitingConfirmation: { value: boolean }
  exited: { value: boolean }
  exit: () => Promise<void>
  confirm: () => Promise<void>
  cancel: () => void
}

const EXIT_MODULE = '../../../../web/src/composables/usePageExit.js'

/** The module's one export, checked rather than asserted onto an `any` import. */
function isExitModule(value: unknown): value is { usePageExit: () => ExitStore } {
  return typeof value === 'object' && value !== null && 'usePageExit' in value
}

/** A fresh module instance, because the store is module-scoped state. */
async function loadExit(): Promise<ExitStore> {
  const module: unknown = await import(EXIT_MODULE)
  if (!isExitModule(module)) throw new Error('the exit module did not export usePageExit')
  return module.usePageExit()
}

/** The service's answer while a Run is in flight and the caller has not consented. */
const CONFIRM_REQUIRED = {
  status: 409,
  ok: false,
  body: {
    exiting: false,
    refusal: { code: 'exit-confirm-required', missing: [] },
  },
}

/** The service's accepted answer, exactly `{"exiting": true}` (spec #93). */
const ACCEPTED: { status: number; ok: boolean; body: ConsoleExitPayload } = {
  status: 202,
  ok: true,
  body: { exiting: true },
}

beforeEach(() => {
  vi.resetModules()
  mocks.postJson.mockReset()
  mocks.halt.mockReset()
})

describe('usePageExit', () => {
  it('forgets an interrupted Run when the reader keeps running', async () => {
    const store = await loadExit()

    mocks.postJson.mockResolvedValueOnce(CONFIRM_REQUIRED)
    await store.exit()

    expect(store.awaitingConfirmation.value).toBe(true)
    expect(store.interruptedRun.value).toBe(true)

    // "Keep running": nothing stopped, so there is no interrupted exit to
    // describe, and the next one starts from what it actually finds.
    store.cancel()
    expect(store.awaitingConfirmation.value).toBe(false)
    expect(store.interruptedRun.value).toBe(false)

    // A later idle exit is accepted and must not inherit the withdrawn claim.
    mocks.postJson.mockResolvedValueOnce(ACCEPTED)
    await store.exit()

    expect(store.exited.value).toBe(true)
    expect(store.interruptedRun.value).toBe(false)
    expect(mocks.halt).toHaveBeenCalledTimes(1)
  })

  it('keeps the interruption when the reader confirms the exit', async () => {
    const store = await loadExit()

    mocks.postJson.mockResolvedValueOnce(CONFIRM_REQUIRED)
    await store.exit()
    mocks.postJson.mockResolvedValueOnce(ACCEPTED)
    await store.confirm()

    // The exit that is happening is the one the 409 named, so the notice after
    // it must still say the Run log may be truncated.
    expect(store.exited.value).toBe(true)
    expect(store.interruptedRun.value).toBe(true)
    expect(store.awaitingConfirmation.value).toBe(false)
  })
})
