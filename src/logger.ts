import type { Logger } from 'pino'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import pino from 'pino'

export type { Logger } from 'pino'

export function createLogger(logDir: string): Logger {
  fs.mkdirSync(logDir, { recursive: true })

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19)
  const logFile = path.join(logDir, `save-wallpapers-${timestamp}.jsonl`)

  return pino({
    level: process.env.LOG_LEVEL ?? 'debug',
    transport: {
      targets: [
        {
          target: 'pino-pretty',
          options: { colorize: true },
          level: 'info',
        },
        {
          target: 'pino/file',
          options: { destination: logFile },
          level: 'debug',
        },
      ],
    },
  })
}
