import * as fs from 'node:fs'
import * as path from 'node:path'
import { PAGE_HASH, PROJECT_ROOT } from './config.js'

// ── build run-code script ──────────────────────────────────────────

export function buildRunCodeScript(): string {
  const scriptFile = path.resolve(PROJECT_ROOT, 'scripts', 'run-discovery.js')
  const raw = fs.readFileSync(scriptFile, 'utf8')
  return raw.replace('__PAGE_HASH__', PAGE_HASH)
}
