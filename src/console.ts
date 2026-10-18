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
import { missingPrerequisites, tsxEntryPath } from './console/prerequisites.js'
import { createRunLauncher, createRunStarter } from './console/run-control.js'
import { createRunLogSource } from './console/run-log-source.js'
import { startConsoleServer } from './console/server.js'
import { UNREAD_GALLERY_FACTS } from './console/status.js'

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

async function main(options: ConsoleOptions): Promise<void> {
  const config = consoleConfig()
  await ensureBundle(config)

  // Run control (#34). The launcher owns the child; the log source reads the
  // Runs — its own and the ones a terminal started — from the Run log
  // directory, because a Run's truth is its log, never a handle (ADR 0009). The
  // starter is the one-at-a-time rule plus the global prerequisite check.
  const launcher = createRunLauncher({
    nodePath: process.execPath,
    tsxEntry: tsxEntryPath(config.projectRoot),
    mainEntry: path.join(config.projectRoot, 'src', 'main.ts'),
    projectRoot: config.projectRoot,
  })
  const runLogSource = createRunLogSource({
    logDir: config.logDir,
    galleryStateFile: config.galleryStateFile,
    imagesDir: config.imagesDir,
    liveChild: () => launcher.isAlive(),
  })
  const startRun = createRunStarter({
    launcher,
    isRunInFlight: () => runLogSource.facts().state === 'running',
    missingPrerequisites: () => missingPrerequisites({ projectRoot: config.projectRoot }),
  })

  const service = await startConsoleServer(config, {
    // The Run half is read from the Run log directory, so a Run started from a
    // terminal appears exactly like one started here. The Gallery list half is
    // still #33's, which is why it is the unread value.
    runState: () => runLogSource.facts(),
    galleryFacts: () => UNREAD_GALLERY_FACTS,
    startRun,
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
