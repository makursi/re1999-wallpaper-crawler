// ── The Run report a list-driven Run writes (#76) ───────────────────
//
// The ticket's acceptance is that the report's shape, the three-state verdict
// and `check-run`'s exit codes do not change while Discovery stops being a
// browser crawl. `core/discovery/discovery.ts` re-points the report's capture
// fields at the list; this test drives the whole contract across the seam:
// Discovery → buildRunReport → the Run log line → parseRunReport → assessRun.
//
// The reader's schema carries an invariant — the Mirror gap and the Site asset
// check are both `null` or neither is — so a re-pointed field that broke it would
// make every new Run log unreadable, which is exactly the failure this pins.

import { describe, expect, it } from 'vitest'

import { discoverFromList } from '../../../core/discovery/discovery.js'
import type { GalleryList } from '../../../core/gallery/gallery-source.js'
import type { GalleryStats } from '../../../core/gallery/gallery-state.js'
import type { RunMeta } from '../../../core/report/report.js'
import { buildRunReport, classifyOutcomes } from '../../../core/report/report.js'
import { assessRun, parseRunReport } from '../../../core/report/run-log.js'

const CDN = 'https://gamecms-res.sl916.com/official_website_resource/50001/4/PICTURE'

const META: RunMeta = {
  runId: '2026-10-21T09-00-00',
  startedAt: '2026-10-21T09:00:00.000Z',
  config: { BASE_ORIGIN: 'https://re.bluepoch.com' },
}

const FINISHED_AT = '2026-10-21T09:00:02.000Z'

function listOf(urls: readonly string[]): GalleryList {
  return { total: urls.length, entries: urls.map((url, i) => ({ id: 1000 + i, url })) }
}

const NO_GAP: GalleryStats = {
  officialTotal: 2,
  newSinceLastRun: 0,
  newFiles: [],
  firstRun: false,
  mirror: {
    missingFromDisk: { count: 0, files: [] },
    extraOnDisk: { count: 0, files: [] },
  },
}

const UNAVAILABLE: GalleryStats = {
  officialTotal: null,
  newSinceLastRun: null,
  newFiles: [],
  firstRun: false,
  mirror: null,
}

/** A report as the Run log carries it, read back the way `check-run` reads it. */
function roundTrip(report: ReturnType<typeof buildRunReport>) {
  return parseRunReport(JSON.stringify(report))
}

describe('a list-driven Run report', () => {
  it('keeps its shape and reads back clean while every Wallpaper is on disk', () => {
    const discovery = discoverFromList(listOf([`${CDN}/1012.jpg`, `${CDN}/1011.jpg`]), 160)
    const report = buildRunReport(META, FINISHED_AT, {
      discovery: discovery.stats,
      metrics: classifyOutcomes([
        { kind: 'skipped', url: discovery.urls[0], filename: '1012.jpg' },
        { kind: 'skipped', url: discovery.urls[1], filename: '1011.jpg' },
      ]),
      gallery: NO_GAP,
      ...discovery.capture,
    })

    const parsed = roundTrip(report)
    expect(parsed).not.toBeNull()
    expect(Object.keys(parsed ?? {}).toSorted()).toEqual([
      'defects',
      'discovery',
      'download',
      'durationMs',
      'failures',
      'finishedAt',
      'gallery',
      'runId',
      'siteAssets',
      'startedAt',
      'type',
    ])

    // The re-pointed fields: coverage is 1, the capture counters are the list's,
    // and the Site asset section is present and empty because nothing is captured.
    expect(parsed?.discovery.coverage).toBe(1)
    expect(parsed?.discovery.combinedCount).toBe(2)
    expect(parsed?.discovery.converged).toBe(true)
    expect(parsed?.siteAssets).toEqual({ count: 0, urls: [] })
    expect(parsed?.defects.discoveryLeak).toEqual({ count: 0, urls: [] })

    const verdict = assessRun(
      parsed,
      { version: 1, ids: [1000, 1001], updatedAt: FINISHED_AT, runId: META.runId },
      () => true,
    )
    expect(verdict.verdict).toBe('clean')
  })

  it('reads an unavailable list as a defect rather than as a clean empty Run', () => {
    const discovery = discoverFromList(null, 25)
    const report = buildRunReport(META, FINISHED_AT, {
      discovery: discovery.stats,
      metrics: classifyOutcomes([]),
      gallery: UNAVAILABLE,
      ...discovery.capture,
    })

    const parsed = roundTrip(report)
    expect(parsed).not.toBeNull()
    // The reader's invariant survives: the list was unavailable, so the Mirror
    // gap, the Site asset check and the coverage are all "not checked".
    expect(parsed?.defects.mirrorGap).toBeNull()
    expect(parsed?.defects.siteAssetFalsePositive).toBeNull()
    expect(parsed?.discovery.coverage).toBeNull()

    const verdict = assessRun(
      parsed,
      { version: 1, ids: [], updatedAt: FINISHED_AT, runId: META.runId },
      () => true,
    )
    expect(verdict.verdict).toBe('defect')
    expect(verdict.defects?.gallerySourceUnavailable).toBe(true)
  })
})
