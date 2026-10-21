// ── The second double-click's handshake, over a real socket (#82) ────
//
// A bound service, a real record, and the question every later start asks: "is
// the program that wrote this still answering?" The answer is a page URL the
// caller then opens — never a second service.
//
// The two stale shapes are proved against real sockets as well: a record whose
// port has stopped listening (a crash, a killed window) and a record whose token
// belongs to an earlier boot (a saved URL). Both must answer "start normally",
// because both are the case the handshake exists to survive.

import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import type { ConsoleConfig } from '../../../web/server/console-config.js'
import { runningInstanceUrl } from '../../../web/server/instance-handshake.js'
import {
  instanceRecordPath,
  readInstanceRecord,
  writeInstanceRecord,
} from '../../../web/server/instance-record.js'
import type { ConsoleService } from '../../../web/server/server.js'
import { startConsoleServer } from '../../../web/server/server.js'
import { IDLE_RUN_FACTS, UNREAD_GALLERY_FACTS } from '../../../web/server/status.js'
import { consoleConfigIn, fixtureAppRoot } from './run-fixtures.js'

const roots: string[] = []
const services: ConsoleService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.close().catch(() => {})))
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** One real Console over a temporary data directory, bound to an OS port. */
async function startService(token: string): Promise<{
  config: ConsoleConfig
  service: ConsoleService
}> {
  const appRoot = fixtureAppRoot('console-instance-handshake-')
  roots.push(appRoot)
  const config = consoleConfigIn(appRoot)
  const service = await startConsoleServer(config, {
    runState: () => IDLE_RUN_FACTS,
    galleryFacts: async () => UNREAD_GALLERY_FACTS,
    startRun: async () => ({
      started: false,
      status: 409,
      refusal: { code: 'run-busy', missing: [] },
    }),
    token,
    port: 0,
  })
  services.push(service)
  return { config, service }
}

/** Publish a record for a service that is (or was) listening on its port. */
function publishFor(
  config: ConsoleConfig,
  service: ConsoleService,
  token: string,
  pid = process.pid,
): void {
  writeInstanceRecord(instanceRecordPath(config.dataRoot), {
    port: service.port,
    token,
    pid,
  })
}

/** Stop one service without making `afterEach` close it twice. */
async function stop(service: ConsoleService): Promise<void> {
  const index = services.indexOf(service)
  if (index >= 0) services.splice(index, 1)
  await service.close()
}

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('runningInstanceUrl', () => {
  it('answers with the running service own page, and starts nothing', async () => {
    const { config, service } = await startService(TOKEN)
    publishFor(config, service, TOKEN)

    const url = await runningInstanceUrl(config.dataRoot)

    // Exactly the URL the first service printed: the second double-click points
    // the browser back at the page that is already up. Nothing bound a second
    // port, and the record still names the one service that did.
    expect(url).toBe(service.url)
    expect(readInstanceRecord(instanceRecordPath(config.dataRoot))).toMatchObject({
      kind: 'record',
      record: { port: service.port, token: TOKEN, pid: process.pid },
    })
  })

  it('starts normally when no record has been written', async () => {
    const { config } = await startService(TOKEN)

    await expect(runningInstanceUrl(config.dataRoot)).resolves.toBeNull()
  })

  it('starts normally when the recorded service has stopped', async () => {
    const { config, service } = await startService(TOKEN)
    publishFor(config, service, TOKEN)
    const stoppedPort = service.port
    await stop(service)

    // The record is still on disk and still names a port; nothing answers there
    // any more, which is exactly the stale shape a crash leaves behind.
    const url = await runningInstanceUrl(config.dataRoot)

    expect(url).toBeNull()
    expect(stoppedPort).toBeGreaterThan(0)
  })

  it('refuses a URL saved from an earlier boot: the token is per boot', async () => {
    const { config, service } = await startService(TOKEN)
    // A previous boot's record, pointing at this boot's port with the previous
    // boot's token — the "saved URL must not survive a restart" case.
    publishFor(config, service, randomBytes(16).toString('hex'))

    await expect(runningInstanceUrl(config.dataRoot)).resolves.toBeNull()
  })

  it('treats an unreadable record as no record', async () => {
    const { config } = await startService(TOKEN)
    const file = instanceRecordPath(config.dataRoot)
    fs.mkdirSync(config.dataRoot, { recursive: true })
    fs.writeFileSync(file, 'half a record', 'utf8')

    await expect(runningInstanceUrl(config.dataRoot)).resolves.toBeNull()
  })
})
