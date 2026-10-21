// ── The Console's entry point ───────────────────────────────────────
//
// The one command: build the page if it is not on disk, start the loopback
// service, print the URL it bound and open it in the default browser. It
// resolves the one application root (#78), reads the layered configuration
// through `core/config-read.ts`'s file-reading predicate — the same schema
// `core/config.ts` parses eagerly for the pipeline — and injects a configuration
// value, so nothing under `web/server/` ever reads the environment and
// `tests/**` keeps needing no `.env` (spec decision 29). A missing or broken
// layer is not fatal here: the Console boots, says a Run cannot be configured
// yet, and leaves the failing fast to the Run (#57).
//
// The Console deliberately never loads the files into `process.env`: dotenv does
// not override, so a value that was wrong at boot would shadow a corrected file
// forever and the setup notice could never clear without a restart (#60). The
// Run is unaffected — it reads the same layers through its own root.
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

import { dataRootOf, resolveAppRoot } from '../../core/app-root.js'
import { readLayeredConfig, siteConfig } from '../../core/config-read.js'
import { fetchGalleryList } from '../../core/gallery/gallery-source.js'
import { newestRunLogName } from '../../core/run-log-file.js'
import type { ConsoleRunState } from '../api-types.js'
import type { ConsoleConfig } from './console-config.js'
import { consoleConfigOf, DEFAULT_CONSOLE_PORT } from './console-config.js'
import type { GalleryListSource } from './gallery-list-source.js'
import { createGalleryListSource } from './gallery-list-source.js'
import { createImageSizeCache } from './image-sizes.js'
import { missingPrerequisites, runEnvFileAvailable, tsxEntryPath } from './prerequisites.js'
import type { RunLauncher } from './run-control.js'
import {
  createBrowserSessionCloser,
  createRunCleaner,
  createRunLauncher,
  createRunStarter,
  stopDecision,
} from './run-control.js'
import { createRunLogSource } from './run-log-source.js'
import { readNewestRunReport } from './run-report-source.js'
import type { ConsoleService, ThumbnailSource } from './server.js'
import { startConsoleServer } from './server.js'
import { galleryFactsOf } from './status.js'
import {
  ensureThumbnail,
  realImageSizeReader,
  realThumbnailCache,
  realThumbnailGenerator,
  THUMBNAIL_CACHE_DIR_NAME,
} from './thumbnails.js'

interface ConsoleOptions {
  port: number
  open: boolean
}

/**
 * The Gallery list source for the injected configuration.
 *
 * With no endpoint there is nothing to ask: the source answers the contract's
 * "not read" without making a request, which is the same answer a configured
 * Console gives when its read fails. No URL is ever built from a missing origin.
 */
function galleryListSource(endpoint: string | null): GalleryListSource {
  if (endpoint === null) return { get: async () => null }
  return createGalleryListSource({
    fetchList: () => fetchGalleryList({ endpoint }),
  })
}

/**
 * The thumbnail source the service is given (#35; spec decision 29). This is the
 * composition root, so it is the one place that knows the web layer's root, the
 * real filesystem and the image library: `web/server/server.ts` receives the
 * source whole and never reaches for `sharp` or for a cache path itself.
 *
 * The cache lives under the app root's web layer — never inside the Mirror
 * (ADR 0010) — and the name that keys it is the Wallpaper's own, which embeds a
 * content hash, so a hit needs no invalidation. `web/server/thumbnails.ts` is the
 * image library's only import site, and the import is dynamic on purpose: a
 * broken or absent native addon arrives as a rejected `await import('sharp')` — a
 * named 500 at the request site, never a crashed process and never a failed Run.
 */
function realThumbnailSource(appRoot: string): ThumbnailSource {
  const cacheDir = path.join(appRoot, 'web', THUMBNAIL_CACHE_DIR_NAME)
  return {
    thumbnail: async (name, sourceFile) => {
      const file = await ensureThumbnail(name, {
        imagesDir: path.dirname(sourceFile),
        cacheDir,
        generate: realThumbnailGenerator,
        cache: realThumbnailCache,
      })
      return fs.readFileSync(file)
    },
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
    throw new Error(`--port 必须是 0..65535 之间的整数,收到的是 ${values.port}`)
  }

  return { port, open: !values['no-open'] }
}

/**
 * ADR 0011: the first start pays the build, later starts reuse it. Vite's
 * programmatic API keeps the build in this process — no shell, no `npx`, and no
 * child process of our own — and the import is lazy, so the bundler never
 * enters the service's module graph.
 *
 * The config file is the layer's own (`<appRoot>/web/vite.config.ts`), and Vite
 * resolves the page, the entry document and the output directory from it, so
 * this process names one path and the config owns the rest. The path comes from
 * the injected app root, never from this module's location.
 */
async function ensureBundle(config: ConsoleConfig): Promise<void> {
  if (fs.existsSync(path.join(config.distDir, 'index.html'))) return

  process.stdout.write('正在构建页面…\n')
  const { build } = await import('vite')
  await build({ configFile: path.join(config.appRoot, 'web', 'vite.config.ts') })
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
        ? '有一个 Run 正在运行。要停掉它和服务吗?[y/N] '
        : '有一个 Run 正在运行,但本 WebUI 没有启动它、也没有可杀的子进程。还要停掉服务吗?[y/N] '
      if (!(await askYesNo(question))) {
        process.stdout.write('保持服务与 Run 继续运行。\n')
        asking = false
        return
      }
      if (!ownsRun) {
        process.stdout.write('本 WebUI 没有启动那个 Run:只有服务会停止,Run 可能继续写入。\n')
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
  // The one application root, resolved here and passed down (#78): a packaged
  // launcher names it in `RE1999_APP_ROOT`; a source run falls back to the
  // process's working directory. Nothing below this point derives it.
  const appRoot = resolveAppRoot()
  const dataRoot = dataRootOf(appRoot)

  // The tolerant, layered read (#57, #60, #78): the shipped `app/.env` and the
  // optional `data/user.env`, validated through the full schema with the process
  // environment merged over both. An absent file, an unparsable one or a
  // malformed value all come out as `null`, and everything below still has the
  // defaults it needs. The files are deliberately not loaded into `process.env` —
  // a boot-time load would freeze a wrong value over a corrected file.
  const layered = readLayeredConfig({ appRoot, dataRoot })
  if (layered.notice !== null) process.stdout.write(`${layered.notice}\n`)

  const values = layered.values
  const site = siteConfig(appRoot, values)
  const config = consoleConfigOf(appRoot, values, site)
  await ensureBundle(config)

  // One cached read of the Gallery list serves both `/api/status` (its
  // `officialTotal` / `listAvailable`) and `/api/gallery` (the rows) — the page
  // polls, so the endpoint is read once per TTL, and a refused read is
  // remembered rather than retried once per request (spec decision 19; #33).
  const galleryList = galleryListSource(config.galleryListEndpoint)

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
    tsxEntry: tsxEntryPath(config.appRoot),
    mainEntry: path.join(config.appRoot, 'core', 'main.ts'),
    appRoot: config.appRoot,
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
    refusalCode: () => (runLogSource.facts().state === 'orphaned' ? 'orphaned-run' : null),
    missingPrerequisites: () => missingPrerequisites({ appRoot: config.appRoot, dataRoot }),
  })
  const cleanupRun = createRunCleaner({
    // Never clean under a live Run; that is the one refusal (ADR 0009).
    isRunInFlight: () => runLogSource.facts().state === 'running',
    closeBrowserSession: createBrowserSessionCloser({ sessionName: site.sessionName }),
    acknowledgeOrphan: () => runLogSource.acknowledgeOrphan(),
  })

  const service = await startConsoleServer(config, {
    // The Run half is read from the Run log directory, so a Run started from a
    // terminal appears exactly like one started here (ADR 0009).
    runState: () => runLogSource.facts(),
    galleryFacts: async () => galleryFactsOf(await galleryList.get()),
    galleryList,
    // #60: the page's setup notice has to clear on the next status read once a
    // usable layer exists, so this is the configuration half of
    // `missingPrerequisites` read again per request — two small files, no `PATH`
    // scan and no registry lookup — and the same predicate the start refuses on,
    // so notice and refusal agree.
    runConfigAvailable: () => runEnvFileAvailable(config.appRoot, dataRoot),
    // The one Run number the gallery view needs (#33), read from the newest Run
    // log exactly as `check-run` reads it — never recomputed from the Gallery
    // state, which would give 0.
    newSinceLastRun: () => readNewestRunReport(config.logDir)?.gallery.newSinceLastRun ?? null,
    // The image library's one call site (#35). Its import is dynamic and lives
    // inside `web/server/thumbnails.ts`, so a broken native binary is a 500 on
    // one tile — never a crash, and never a failed Run.
    thumbnailSource: realThumbnailSource(config.appRoot),
    // The wall's second input (#48): each Wallpaper's own pixel size, so the
    // masonry can place a tile before its lazy thumbnail arrives. Memoised here
    // rather than in the route, because the measurement has to outlive a
    // request — the Mirror does not change under a page that is merely reloading
    // it, and the names embed a content hash, so a hit is never stale.
    imageSizeSource: createImageSizeCache(realImageSizeReader),
    startRun,
    cleanupRun,
    token: randomBytes(16).toString('hex'),
    port: options.port,
  })

  // Always the port actually bound: the preferred one is only a preference
  // (spec decision 3).
  if (service.fellBack) {
    process.stdout.write(`端口 ${options.port} 被占用,改用 ${service.port}。\n`)
  }
  process.stdout.write(`WebUI: ${service.url}\n`)

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
  console.error('致命错误:', error)
  process.exit(1)
})
