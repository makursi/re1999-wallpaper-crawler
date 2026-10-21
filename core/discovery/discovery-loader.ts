import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { APP_ROOT, PAGE_HASH, RUN_CACHE_DIR } from '../config.js'

// ── the Discovery script copy ──────────────────────────────────────
//
// `playwright-cli run-code` can only be handed a file (`--filename`), so a Run
// has to materialize the payload. It does so exactly once per payload version:
// the content on disk is compared before anything is written, and the copy is
// never deleted — a Run that changes nothing performs no write at all, and
// whatever corrupted the copy is repaired by the next Run (#51).

/** The name the materialized copy carries inside its directory. */
const COPY_NAME = 'run-discovery.generated.js'

export interface DiscoveryScriptCopy {
  /** Absolute path of the copy, ready for `run-code --filename`. */
  path: string
  /** Whether this call wrote, i.e. the content differed from what was on disk. */
  written: boolean
  /** SHA-256 of the content that is now on disk. */
  sha256: string
}

export interface MaterializeOptions {
  /** Where the copy lives; defaults to the Run cache. */
  dir?: string
  /** The payload to materialize; defaults to the repository's own. */
  source?: string
  /** The page hash substituted into the payload; defaults to the configured one. */
  hash?: string
}

// The payload is a bare expression (see AGENTS.md › "The run-code script is a
// protocol payload"), so the only transformation is its one placeholder.
function buildRunCodeScript(options: MaterializeOptions): string {
  const source = options.source ?? path.join(APP_ROOT, 'scripts', 'run-discovery.js')
  const hash = options.hash ?? PAGE_HASH
  return fs.readFileSync(source, 'utf8').replace('__PAGE_HASH__', hash)
}

function readIfPresent(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (err) {
    // "Nothing there yet" is the one failure that is not a failure; anything else
    // (a permission problem, an unreadable directory) has to stop the Run.
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT')
      return null
    throw err
  }
}

/**
 * Materializes the Discovery script copy into its directory: written only when
 * its content differs from what is already there, and never removed.
 */
export function materializeDiscoveryScript(options: MaterializeOptions = {}): DiscoveryScriptCopy {
  const dir = path.resolve(options.dir ?? RUN_CACHE_DIR)
  const content = buildRunCodeScript(options)
  const file = path.join(dir, COPY_NAME)
  const written = readIfPresent(file) !== content

  if (written) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, content, 'utf8')
  }

  return { path: file, written, sha256: createHash('sha256').update(content).digest('hex') }
}
