// ── check-run: print the newest Run's verdict ───────────────────────
//
// The CLI entry for `pnpm check-run`: find the newest Run log, read the Run
// report out of it, and print the verdict. It owns every filesystem call — the
// newest log, the Gallery state, and the file probe — and the exit code; the
// verdict itself is the pure `assessRun` in `src/report/run-log.ts`.
//
// That split is the same one `src/main.ts` keeps: this file is glue, and the
// logic that can be wrong lives where it can be tested.

import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

import { GALLERY_STATE_FILE, LOG_DIR } from './config.js'
import { readGalleryState } from './gallery/gallery-state.js'
import type { RunReport } from './report/report.js'
import type { RunVerdict } from './report/run-log.js'
import { assessRun, parseRunReport } from './report/run-log.js'

/** One line of the verdict, on stdout, so the output can be piped and read. */
function line(text: string): void {
  process.stdout.write(`${text}\n`)
}

/**
 * The newest Run log, or `null` when there is none. The filename carries the
 * timestamp, so the last name in ascending order is the newest Run — the
 * ordering is exact, not a guess from mtimes.
 */
function newestLogFile(dir: string): string | null {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  const runLogs = names.filter(
    name => name.startsWith('save-wallpapers-') && name.endsWith('.jsonl'),
  )
  const newest = runLogs.toSorted().at(-1)
  return newest === undefined ? null : path.join(dir, newest)
}

function logTextOf(file: string | null): string | null {
  if (file === null) return null
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * A Run report's claimed new files are Wallpaper filenames, named the way
 * Download names them (ADR 0004 / the Mirror check), so the probe resolves them
 * inside the Mirror rather than re-deriving anything from a URL.
 */
function fileProbe(imagesDir: string): (filename: string) => boolean {
  return filename => {
    try {
      return fs.statSync(path.join(imagesDir, filename)).size > 0
    } catch {
      return false
    }
  }
}

function printVerdict(
  verdict: RunVerdict,
  logFile: string | null,
  report: RunReport | null,
  stateRunId: string | null,
): void {
  line(`Run log : ${logFile ?? 'none'}`)
  line(`Verdict : ${verdict.verdict}`)

  if (report === null) {
    // The runbook's inversion: a Run log that stops before its report is a
    // defect in the log, not proof the Run failed. Say so rather than leaving
    // it to be inferred from empty output.
    line('Run report : MISSING — this is a defect in the log, not proof the Run failed')
    if (verdict.stateMatchesReport === null) {
      line('Gallery state : unreadable — was the Run killed before its last step?')
    } else if (verdict.stateMatchesReport) {
      line('Gallery state : names this same Run — it finished, its report is what is lost')
    } else {
      line(`Gallery state : names another Run (${stateRunId ?? 'unknown runId'})`)
    }
    return
  }

  const g = report.gallery
  const d = report.download
  line(`Run report : present`)
  line(`Run id : ${report.runId}`)
  line(
    `Gallery state : ${
      verdict.stateMatchesReport === null
        ? 'unreadable (not checked)'
        : verdict.stateMatchesReport
          ? 'matches the report'
          : 'does NOT match the report'
    }`,
  )
  line(
    `Gallery : officialTotal ${g.officialTotal ?? 'unknown'}, newSinceLastRun ${
      g.newSinceLastRun ?? 'unknown'
    }, newFiles ${g.newFiles.length}`,
  )
  line(
    `Mirror : ${
      g.mirror === null
        ? 'not checked (the Gallery list was unavailable)'
        : `missing ${g.mirror.missingFromDisk.count}, extra ${g.mirror.extraOnDisk.count}`
    }`,
  )
  line(
    `Download : ok ${d.ok}, skipped ${d.skipped}, failed ${d.failed}, successRate ${d.successRate}`,
  )
  line('Defects (verbatim from the Run report):')
  line(JSON.stringify(report.defects))
  if (verdict.explained.length > 0) {
    line('Explained (routine, recorded rather than failed):')
    for (const item of verdict.explained) line(`  - ${item}`)
  }
  line(`Claimed new files missing on disk : ${verdict.missingOnDisk.length}`)
  for (const filename of verdict.missingOnDisk) line(`  - ${filename}`)
}

async function main(): Promise<void> {
  const logFile = newestLogFile(LOG_DIR)
  const report = parseRunReport(logTextOf(logFile) ?? '')
  // The Mirror is `images/`; the state file sits in it, so it is derived rather
  // than configured separately.
  const imagesDir = path.dirname(GALLERY_STATE_FILE)
  const state = readGalleryState(GALLERY_STATE_FILE)
  const verdict = assessRun(report, state, fileProbe(imagesDir))

  printVerdict(verdict, logFile, report, state?.runId ?? null)
  process.exitCode = verdict.verdict === 'defect' ? 1 : 0
}

main().catch(error => {
  console.error('Fatal:', error)
  process.exitCode = 1
})
