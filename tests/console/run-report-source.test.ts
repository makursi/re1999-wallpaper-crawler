import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { newestRunLogName, readNewestRunReport } from '../../src/console/run-report-source.js'
import type { RunReport } from '../../src/report/report.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function logDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-logs-'))
  dirs.push(dir)
  return dir
}

/** A Run report record, as `src/main.ts` writes it — one JSONL line, verbatim. */
function report(over: Partial<RunReport> = {}): RunReport {
  return {
    type: 'run_report',
    runId: '2026-10-18T01-03-31',
    startedAt: '2026-10-18T01:03:31.856Z',
    finishedAt: '2026-10-18T01:07:09.045Z',
    durationMs: 217189,
    discovery: {
      converged: true,
      stableRounds: 6,
      totalIdleSec: 60,
      networkCount: 78,
      domCount: 75,
      combinedCount: 79,
      thumbnailsClicked: 15,
      discoveryDurationMs: 173592,
      coverage: 0.0446,
    },
    download: {
      total: 0,
      ok: 0,
      skipped: 0,
      failed: 0,
      successRate: 0,
      retryRescued: 0,
      retryTotal: 0,
      rescueRate: 0,
      emptyFiles: 0,
      emptyFilenames: [],
      persistentFailures: 0,
      totalBytes: 0,
      avgDownloadMs: 0,
      statusHistogram: {},
      failureGroups: [],
      failures: [],
    },
    gallery: {
      officialTotal: 1010,
      newSinceLastRun: 12,
      newFiles: [],
      firstRun: false,
      mirror: { missingFromDisk: { count: 0, files: [] }, extraOnDisk: { count: 0, files: [] } },
    },
    siteAssets: { count: 0, urls: [] },
    defects: {
      discoveryLeak: { count: 0, urls: [] },
      nonConverged: false,
      emptyResult: false,
      persistentFailures: 0,
      emptyFiles: [],
      siteAssetFalsePositive: { count: 0, urls: [] },
      gallerySourceUnavailable: false,
      mirrorGap: { missing: 0, extra: 0 },
    },
    failures: [],
    ...over,
  }
}

function writeLog(dir: string, runId: string, lines: unknown[]): string {
  const file = path.join(dir, `save-wallpapers-${runId}.jsonl`)
  fs.writeFileSync(file, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`, 'utf8')
  return file
}

describe('readNewestRunReport', () => {
  it('reads the newest Run log by name, not by modification time', () => {
    const dir = logDir()
    const older = writeLog(dir, '2026-10-17T00-00-00', [
      report({
        gallery: {
          officialTotal: 998,
          newSinceLastRun: 3,
          newFiles: [],
          firstRun: false,
          mirror: {
            missingFromDisk: { count: 0, files: [] },
            extraOnDisk: { count: 0, files: [] },
          },
        },
      }),
    ])
    const newest = writeLog(dir, '2026-10-18T01-03-31', [report()])

    // Make the *newer-named* log the older file, so an mtime-based reader would
    // pick the wrong Run — `check-run` picks by name and so must the Console.
    const old = new Date('2020-01-01T00:00:00.000Z')
    fs.utimesSync(newest, old, old)
    fs.utimesSync(older, new Date(), new Date())

    expect(newestRunLogName(dir)).toBe('save-wallpapers-2026-10-18T01-03-31.jsonl')
    expect(readNewestRunReport(dir)?.gallery.newSinceLastRun).toBe(12)
    expect(readNewestRunReport(dir)?.gallery.officialTotal).toBe(1010)
  })

  it('finds the report even when the Run log runs past it', () => {
    // The real newest log carries its report at line 116 of 136 (the summary
    // lines follow), so the report is a record among many, not the last line.
    const dir = logDir()
    writeLog(dir, '2026-10-18T01-03-31', [
      report(),
      { level: 30, msg: 'Download : ok 12, skipped 33, failed 0' },
      { level: 30, msg: '===== done =====' },
    ])

    expect(readNewestRunReport(dir)?.gallery.newSinceLastRun).toBe(12)
  })

  it('returns null when the Run log directory is not there, or holds nothing to read', () => {
    const dir = logDir()

    expect(newestRunLogName(dir)).toBeNull()
    expect(readNewestRunReport(path.join(dir, 'not-here'))).toBeNull()
  })

  it('ignores files that are not Run logs, and a log with no report', () => {
    const dir = logDir()
    fs.writeFileSync(path.join(dir, 'notes.jsonl'), JSON.stringify(report()), 'utf8')
    fs.writeFileSync(
      path.join(dir, 'save-wallpapers-2026-10-18T01-03-31.jsonl.bak'),
      JSON.stringify(report()),
      'utf8',
    )
    // The newest name that *is* a Run log, with a `run_meta` and no report.
    writeLog(dir, '2026-10-18T00-00-00', [{ type: 'run_meta', runId: '2026-10-18T00-00-00' }])

    expect(newestRunLogName(dir)).toBe('save-wallpapers-2026-10-18T00-00-00.jsonl')
    expect(readNewestRunReport(dir)).toBeNull()
  })
})
