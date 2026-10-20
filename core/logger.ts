import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

import type { Logger } from 'pino'
import pino from 'pino'
import pretty from 'pino-pretty'

export type { Logger } from 'pino'

export function createLogger(logDir: string): Logger {
  fs.mkdirSync(logDir, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  // The name is neutral and carries only the Run: it must not name a command
  // that may be deleted. The readers still accept the legacy
  // `save-wallpapers-<runId>.jsonl` every old log on disk has (ADR 0016); the
  // name predicates live in `core/report/run-log.ts`.
  const logFile = path.join(logDir, `run-${timestamp}.jsonl`)

  // The Run log is the Run's audit trail, so it is written on this thread, not
  // by a pino transport worker: `sync: true` means every record is on disk
  // before the logging call returns. It also keeps the lower level of the two
  // sinks, and multistream writes in level order with no error isolation, so
  // the record reaches the file before a console stream that throws can eat
  // it. Raising this level above the console's would invert that, and the array
  // order below would not undo it. See docs/adr/0007.
  return pino(
    { level: process.env.LOG_LEVEL ?? 'debug' },
    pino.multistream([
      { level: 'debug', stream: pino.destination({ dest: logFile, sync: true }) },
      { level: 'info', stream: pretty({ colorize: true }) },
    ]),
  )
}
