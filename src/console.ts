// ── The Console's entry point ───────────────────────────────────────
//
// The one command: build the page if it is not on disk, start the loopback
// service, print the URL it bound and open it in the default browser. It reads
// `src/config.ts` — which parses `.env` at import time — and injects a
// configuration value, so nothing under `src/console/` ever reads the
// environment and `tests/**` keeps needing no `.env` (spec decision 29).
//
// ADR 0008: no dispatcher and no CLI framework. The Console takes `--port` and
// `--no-open` and nothing more; the flags are parsed by Node's own parser.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import {
  GALLERY_LIST_URL,
  GALLERY_STATE_FILE,
  IMAGES_DIR,
  LOG_DIR,
  PROJECT_ROOT,
} from './config.js'
import type { ConsoleConfig } from './console/console-config.js'
import { DEFAULT_CONSOLE_PORT, DIST_DIR_NAME } from './console/console-config.js'
import { createGalleryListSource } from './console/gallery-list-source.js'
import { readNewestRunReport } from './console/run-report-source.js'
import type { RunStarter } from './console/server.js'
import { realThumbnailSource, startConsoleServer } from './console/server.js'
import { galleryFactsOf, IDLE_RUN_FACTS } from './console/status.js'
import { fetchGalleryList } from './gallery/gallery-source.js'

interface ConsoleOptions {
  port: number
  open: boolean
}

/** The Console's configuration, built here and injected into the service. */
function consoleConfig(): ConsoleConfig {
  return {
    projectRoot: PROJECT_ROOT,
    imagesDir: IMAGES_DIR,
    logDir: LOG_DIR,
    galleryStateFile: GALLERY_STATE_FILE,
    distDir: path.join(PROJECT_ROOT, DIST_DIR_NAME),
    galleryListEndpoint: GALLERY_LIST_URL,
  }
}

function consoleOptions(argv: string[]): ConsoleOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      // `parseArgs` has no `--no-*` negation: the option's own name is `no-open`.
      'no-open': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  })

  const port = values.port === undefined ? DEFAULT_CONSOLE_PORT : Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`--port must be a whole number in 0..65535, got ${values.port}`)
  }

  return { port, open: !values['no-open'] }
}

/**
 * ADR 0011: the first start pays the build, later starts reuse it. Vite's
 * programmatic API keeps the build in this process — no shell, no `npx`, and no
 * child process of our own — and the import is lazy, so the bundler never
 * enters the service's module graph.
 */
async function ensureBundle(config: ConsoleConfig): Promise<void> {
  if (fs.existsSync(path.join(config.distDir, 'index.html'))) return

  process.stdout.write('Building the page…\n')
  const { build } = await import('vite')
  await build({ configFile: path.join(config.projectRoot, 'vite.config.ts') })
}

/**
 * Open the page in the default browser.
 *
 * `stdio: 'ignore'` is load-bearing: this repository's notes record that a
 * piped child is refused in a confined sandbox, and a shell-launched URL
 * (`cmd /c start`, `npx`) is mangled by cmd.exe. The URL is already printed, so
 * a machine without an opener is silent rather than fatal.
 */
function openInBrowser(url: string): void {
  const [command, args] = openerFor(process.platform, url)
  const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true })
  child.on('error', () => {
    // Nothing to fall back to; the printed URL is the answer.
  })
  child.unref()
}

function openerFor(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === 'win32') return ['explorer.exe', [url]]
  if (platform === 'darwin') return ['open', [url]]
  return ['xdg-open', [url]]
}

/** #34 implements the Run starter; #32 only fixes the seam's shape. */
const notImplementedYet: RunStarter = async () => ({
  started: false,
  reason: 'starting a Run is not implemented yet',
})

async function main(options: ConsoleOptions): Promise<void> {
  const config = consoleConfig()
  await ensureBundle(config)

  // One cached read of the Gallery list serves both `/api/status` (its
  // `officialTotal` / `listAvailable`) and `/api/gallery` (the rows) — the page
  // polls, so the endpoint is read once per TTL, and a refused read is
  // remembered rather than retried once per request (spec decision 19; #33).
  const galleryList = createGalleryListSource({
    fetchList: () => fetchGalleryList({ endpoint: config.galleryListEndpoint }),
  })

  const service = await startConsoleServer(config, {
    // #34/#36 replace the Run half; #32's fixed idle state stays until then.
    runState: () => IDLE_RUN_FACTS,
    galleryFacts: async () => galleryFactsOf(await galleryList.get()),
    galleryList,
    // The one Run number the gallery view needs (#33), read from the newest Run
    // log exactly as `check-run` reads it — never recomputed from the Gallery
    // state, which would give 0.
    newSinceLastRun: () => readNewestRunReport(config.logDir)?.gallery.newSinceLastRun ?? null,
    // The image library's one call site (#35). Its import is dynamic and lives
    // inside `src/console/thumbnails.ts`, so a broken native binary is a 500 on
    // one tile — never a crash, and never a failed Run.
    thumbnailSource: realThumbnailSource(config.projectRoot),
    // #34 implements the Run starter; #32 only fixes the seam's shape.
    startRun: notImplementedYet,
    token: randomBytes(16).toString('hex'),
    port: options.port,
  })

  // Always the port actually bound: the preferred one is only a preference
  // (spec decision 3).
  if (service.fellBack) {
    process.stdout.write(`Port ${options.port} was taken; bound ${service.port} instead.\n`)
  }
  process.stdout.write(`Console: ${service.url}\n`)

  if (options.open) openInBrowser(service.url)
}

let options: ConsoleOptions
try {
  options = consoleOptions(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}

main(options).catch(error => {
  console.error('Fatal:', error)
  process.exit(1)
})
