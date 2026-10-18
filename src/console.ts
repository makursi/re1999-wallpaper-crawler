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
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'

import {
  GALLERY_LIST_URL,
  GALLERY_STATE_FILE,
  IMAGES_DIR,
  LOG_DIR,
  PROJECT_ROOT,
  SESSION,
} from './config.js'
import type { ConsoleRunState } from './console/api-types.js'
import type { ConsoleConfig } from './console/console-config.js'
import { DEFAULT_CONSOLE_PORT, DIST_DIR_NAME } from './console/console-config.js'
import { createGalleryListSource } from './console/gallery-list-source.js'
import { missingPrerequisites, tsxEntryPath } from './console/prerequisites.js'
import type { RunLauncher } from './console/run-control.js'
import {
  createBrowserSessionCloser,
  createRunCleaner,
  createRunLauncher,
  createRunStarter,
  ORPHANED_RUN_REASON,
  stopDecision,
} from './console/run-control.js'
import { createRunLogSource } from './console/run-log-source.js'
import { newestRunLogName, readNewestRunReport } from './console/run-report-source.js'
import type { ConsoleService } from './console/server.js'
import { startConsoleServer } from './console/server.js'
import { galleryFactsOf } from './console/status.js'
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

/**
 * Ask a yes/no question on the terminal. An unreadable stdin or EOF is a "no":
 * the safe answer is the one that leaves the service and the Run alone.
 */
async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim())
  } catch {
    return false
  } finally {
    rl.close()
  }
}

interface StopDeps {
  /** The Run state, from the Run log directory — never from a handle. */
  runState: () => ConsoleRunState
  launcher: RunLauncher
  service: ConsoleService
}

/**
 * The only stop control there is (ADR 0009; conventions §6). The page has none:
 * closing it never stops anything, because it is a view and the truth is on
 * disk. A signal with no Run in flight shuts down at once; with a Run in flight
 * it asks first — the one gesture most likely to be made must not kill twenty
 * minutes of work. Accepting kills the whole child tree (a headed browser and a
 * truncated Run log are what killing only the first leaves behind); declining
 * leaves both the service and the Run running, and says so.
 *
 * Glue, deliberately: the decision itself is the pure `stopDecision`, and this
 * repository's entries are checked by reading them and by one manual run.
 */
function installStopHandlers(deps: StopDeps): void {
  let asking = false

  const stop = async (): Promise<void> => {
    if (asking) return
    const state = deps.runState()

    if (stopDecision(state) === 'confirm') {
      asking = true
      // A Run this Console did not start has no pid here, so there is no tree
      // to kill: saying it plainly beats pretending a stop happened.
      const ownsRun = deps.launcher.isAlive()
      const question = ownsRun
        ? 'A Run is in flight. Stop it and the service? [y/N] '
        : 'A Run is in flight, but this Console did not start it and has no child process to kill. Stop the service anyway? [y/N] '
      if (!(await askYesNo(question))) {
        process.stdout.write('Leaving the service and the Run running.\n')
        asking = false
        return
      }
      if (!ownsRun) {
        process.stdout.write(
          'This Console did not start that Run: only the service stops, and the Run may keep writing.\n',
        )
      }
    }

    // The whole tree the launcher started: tsx, the browser CLI, the browser.
    deps.launcher.stop()
    await deps.service.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
}

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

  // Run control (#34, #36). The launcher owns the child; the log source reads
  // the Runs — its own and the ones a terminal started — from the Run log
  // directory, because a Run's truth is its log, never a handle (ADR 0009). The
  // starter is the one-at-a-time rule plus the global prerequisite check.
  //
  // The two `on…` hooks are #36's half: the Console notes which turn the log
  // directory was at when it spawned, so that when its child dies it can pin the
  // log that child wrote. That one name is the difference between "the Run we
  // watched die" (orphaned) and "a Run a terminal started since" (running).
  let newestBeforeSpawn: string | null = null
  let ownRunLogName: string | null = null
  const launcher = createRunLauncher({
    nodePath: process.execPath,
    tsxEntry: tsxEntryPath(config.projectRoot),
    mainEntry: path.join(config.projectRoot, 'src', 'main.ts'),
    projectRoot: config.projectRoot,
    onStarted: () => {
      ownRunLogName = null
      newestBeforeSpawn = newestRunLogName(config.logDir)
    },
    onExited: () => {
      const newest = newestRunLogName(config.logDir)
      // A Run our child wrote is the name that appeared while it lived. A
      // terminal Run that starts afterwards writes a newer name and is not ours.
      ownRunLogName = newest !== null && newest !== newestBeforeSpawn ? newest : null
    },
  })
  const runLogSource = createRunLogSource({
    logDir: config.logDir,
    galleryStateFile: config.galleryStateFile,
    imagesDir: config.imagesDir,
    liveChild: () => launcher.isAlive(),
    ownRunLogName: () => ownRunLogName,
  })
  const startRun = createRunStarter({
    launcher,
    // A Run in flight and an Orphaned Run both hold — or may hold — the one
    // persistent Browser session, so neither may be started over; the reason
    // the page shows differs, because the actions differ.
    isRunInFlight: () => runLogSource.facts().state !== 'idle',
    busyReason: () => (runLogSource.facts().state === 'orphaned' ? ORPHANED_RUN_REASON : null),
    missingPrerequisites: () => missingPrerequisites({ projectRoot: config.projectRoot }),
  })
  const cleanupRun = createRunCleaner({
    // Never clean under a live Run; that is the one refusal (ADR 0009).
    isRunInFlight: () => runLogSource.facts().state === 'running',
    closeBrowserSession: createBrowserSessionCloser({ sessionName: SESSION }),
    acknowledgeOrphan: () => runLogSource.acknowledgeOrphan(),
  })

  const service = await startConsoleServer(config, {
    // The Run half is read from the Run log directory, so a Run started from a
    // terminal appears exactly like one started here (ADR 0009).
    runState: () => runLogSource.facts(),
    galleryFacts: async () => galleryFactsOf(await galleryList.get()),
    galleryList,
    // The one Run number the gallery view needs (#33), read from the newest Run
    // log exactly as `check-run` reads it — never recomputed from the Gallery
    // state, which would give 0.
    newSinceLastRun: () => readNewestRunReport(config.logDir)?.gallery.newSinceLastRun ?? null,
    startRun,
    cleanupRun,
    token: randomBytes(16).toString('hex'),
    port: options.port,
  })

  // Always the port actually bound: the preferred one is only a preference
  // (spec decision 3).
  if (service.fellBack) {
    process.stdout.write(`Port ${options.port} was taken; bound ${service.port} instead.\n`)
  }
  process.stdout.write(`Console: ${service.url}\n`)

  // The only stop control (ADR 0009): a signal asks while a Run is in flight,
  // and kills the whole tree when it goes ahead.
  installStopHandlers({ runState: () => runLogSource.facts().state, launcher, service })

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
