import * as fs from 'node:fs'
import * as path from 'node:path'
import { PAGE_HASH } from './config'

// ── build run-code script ──────────────────────────────────────────

export function buildRunCodeScript(): string {
  const scriptFile = path.resolve(__dirname, '..', 'scripts', 'run-discovery.js')
  const raw = fs.readFileSync(scriptFile, 'utf8')
  return raw.replace('__PAGE_HASH__', PAGE_HASH)
}
