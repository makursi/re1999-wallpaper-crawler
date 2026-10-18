import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { RunLogSourceOptions } from '../../src/console/run-log-source.js'
import { createRunLogSource, ORPHAN_WINDOW_MS } from '../../src/console/run-log-source.js'
import {
  galleryState,
  LOG_NAME,
  NEW_FILES,
  plainLine,
  runLog,
  runReport,
  RUN_ID,
} from './run-fixtures.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** A directory tree standing in for the repository: a Mirror and a log dir. */
function fixture(): RunLogSourceOptions {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-run-log-'))
  roots.push(root)
  const logDir = path.join(root, 'logs')
  const imagesDir = path.join(root, 'images')
  fs.mkdirSync(logDir)
  fs.mkdirSync(imagesDir)
  return { logDir, imagesDir, galleryStateFile: path.join(imagesDir, '.gallery-state.json') }
}

function writeLog(logDir: string, name: string, text: string): void {
  fs.writeFileSync(path.join(logDir, name), `${text}\n`, 'utf8')
}

function writeState(options: RunLogSourceOptions): void {
  fs.writeFileSync(options.galleryStateFile, JSON.stringify(galleryState()), 'utf8')
}

describe('createRunLogSource', () => {
  it('reads a Run log written after the Console started as running, then idle with its verdict', () => {
    const options = fixture()
    const source = createRunLogSource(options)

    // The log directory was empty when the Console started.
    expect(source.facts().state).toBe('idle')

    writeLog(options.logDir, LOG_NAME, runLog(plainLine('5. Downloading images...')))
    writeState(options)
    // The Mirror holds the files the Run will claim — so the finished Run is
    // clean, and the verdict asserted below is about the report, not the probe.
    for (const name of NEW_FILES) fs.writeFileSync(path.join(options.imagesDir, name), 'a')

    const running = source.facts()
    expect(running.state).toBe('running')
    // No verdict while the Run is in flight — the log is not finished.
    expect(running.verdict).toBeNull()
    expect(running.runId).toBe(RUN_ID)

    // The report lands: the state returns to idle and the verdict appears.
    writeLog(options.logDir, LOG_NAME, runLog(plainLine('done'), JSON.stringify(runReport())))

    const finished = source.facts()
    expect(finished.state).toBe('idle')
    expect(finished.verdict).toBe('clean')
    expect(finished.report).toEqual(runReport())
    expect(finished.reportPresent).toBe(true)
  })

  it('reads the newest Run log by name, as check-run does, never by mtime', () => {
    const options = fixture()
    const older = 'save-wallpapers-2026-09-15T09-36-50.jsonl'
    writeLog(options.logDir, LOG_NAME, runLog(JSON.stringify(runReport())))
    writeLog(
      options.logDir,
      older,
      runLog(JSON.stringify(runReport({ runId: '2026-09-15T09-36-50' }))),
    )
    // Make the *other* log the more recently written file.
    const past = new Date(Date.now() - 3_600_000)
    fs.utimesSync(path.join(options.logDir, LOG_NAME), past, past)

    const facts = createRunLogSource(options).facts()

    expect(facts.runId).toBe(RUN_ID)
  })

  it('reports an unfinished log older than the window idle, not orphaned', () => {
    const options = fixture()
    writeLog(options.logDir, LOG_NAME, runLog(plainLine('killed mid-write')))

    // The Console starts *after* the log, so it was in the start-up listing.
    const source = createRunLogSource({
      ...options,
      now: () => Date.now() + ORPHAN_WINDOW_MS + 60_000,
    })

    expect(source.facts().state).toBe('idle')
  })

  it('reports running while a child of the Console lives, whatever the log says', () => {
    const options = fixture()
    writeLog(options.logDir, LOG_NAME, runLog(JSON.stringify(runReport())))

    const facts = createRunLogSource({ ...options, liveChild: () => true }).facts()

    expect(facts.state).toBe('running')
  })

  it('probes the claimed new files inside the Mirror, as check-run does', () => {
    const options = fixture()
    // The report claims two new files; only the first is on disk.
    fs.writeFileSync(path.join(options.imagesDir, NEW_FILES[0]), 'a')
    writeLog(options.logDir, LOG_NAME, runLog(JSON.stringify(runReport())))
    writeState(options)

    const facts = createRunLogSource(options).facts()

    expect(facts.verdict).toBe('defect')
  })

  it('carries the record-present fact beside a report it cannot read', () => {
    const options = fixture()
    const older = JSON.stringify({
      type: 'run_report',
      runId: RUN_ID,
      gallery: { officialTotal: 999, previousOfficialTotal: 998 },
    })
    writeLog(options.logDir, LOG_NAME, runLog(older))

    const facts = createRunLogSource(options).facts()

    expect(facts.reportPresent).toBe(true)
    expect(facts.report).toBeNull()
  })

  it('reads the Mirror without writing into it', () => {
    const options = fixture()
    fs.writeFileSync(path.join(options.imagesDir, '1013_8dee54e8.png'), 'a')
    const stateText = JSON.stringify(galleryState(), null, 2)
    fs.writeFileSync(options.galleryStateFile, stateText, 'utf8')
    writeLog(options.logDir, LOG_NAME, runLog(JSON.stringify(runReport())))
    const mirrorBefore = fs.readdirSync(options.imagesDir).toSorted()
    const logsBefore = fs.readdirSync(options.logDir).toSorted()

    const source = createRunLogSource(options)
    source.facts()
    source.facts()

    // The Console writes neither the Gallery state nor the Mirror (spec
    // decision 39; conventions §4).
    expect(fs.readFileSync(options.galleryStateFile, 'utf8')).toBe(stateText)
    expect(fs.readdirSync(options.imagesDir).toSorted()).toEqual(mirrorBefore)
    expect(fs.readdirSync(options.logDir).toSorted()).toEqual(logsBefore)
  })

  it('reads no Run as idle with nothing to show', () => {
    const facts = createRunLogSource(fixture()).facts()

    expect(facts.state).toBe('idle')
    expect(facts.runId).toBeNull()
    expect(facts.report).toBeNull()
    expect(facts.reportPresent).toBe(false)
  })
})
