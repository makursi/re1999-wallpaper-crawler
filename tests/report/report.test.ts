import { describe, expect, it } from 'vitest'

import type { GalleryStats } from '../../src/gallery/gallery-state.js'
import type { DiscoveryStats, DownloadOutcome, RunMeta } from '../../src/report/report.js'
import { buildRunReport, classifyOutcomes, detectLeaks } from '../../src/report/report.js'

function ok(
  url: string,
  filename: string,
  over: Partial<{ status: number; retried: boolean; durationMs: number; bytes: number }> = {},
): DownloadOutcome {
  return {
    kind: 'ok',
    url,
    filename,
    status: over.status ?? 200,
    retried: over.retried ?? false,
    durationMs: over.durationMs ?? 0,
    bytes: over.bytes ?? 100,
  }
}

describe('classifyOutcomes', () => {
  it('returns all-zero metrics for an empty outcome list', () => {
    const m = classifyOutcomes([])
    expect(m.total).toBe(0)
    expect(m.ok).toBe(0)
    expect(m.skipped).toBe(0)
    expect(m.failed).toBe(0)
    expect(m.successRate).toBe(0)
    expect(m.rescueRate).toBe(0)
    expect(m.statusHistogram).toEqual({})
    expect(m.failureGroups).toEqual([])
    expect(m.failures).toEqual([])
  })

  it('computes counts, success rate, retry rescue, bytes and timing', () => {
    const outcomes: DownloadOutcome[] = [
      ok('https://cdn/a.jpg', 'a.jpg', { retried: true, durationMs: 1200, bytes: 2048 }),
      ok('https://cdn/b.jpg', 'b.jpg', { durationMs: 800, bytes: 1024 }),
      ok('https://cdn/empty.jpg', 'empty.jpg', { durationMs: 300, bytes: 0 }),
      { kind: 'skipped', url: 'https://cdn/exists.jpg', filename: 'exists.jpg' },
      {
        kind: 'failed',
        url: 'https://cdn/missing.jpg',
        filename: 'missing.jpg',
        status: 404,
        reason: 'HTTP 404',
        retried: false,
      },
      {
        kind: 'failed',
        url: 'https://cdn/blocked.jpg',
        filename: 'blocked.jpg',
        status: 403,
        reason: 'HTTP 403',
        retried: true,
      },
    ]
    const m = classifyOutcomes(outcomes)

    expect(m.total).toBe(6)
    expect(m.ok).toBe(3)
    expect(m.skipped).toBe(1)
    expect(m.failed).toBe(2)
    expect(m.successRate).toBeCloseTo(0.6)
    expect(m.retryRescued).toBe(1)
    expect(m.retryTotal).toBe(2)
    expect(m.rescueRate).toBeCloseTo(0.5)
    expect(m.emptyFiles).toBe(1)
    expect(m.emptyFilenames).toEqual(['empty.jpg'])
    expect(m.persistentFailures).toBe(1)
    expect(m.totalBytes).toBe(3072)
    expect(m.avgDownloadMs).toBeCloseTo(766.67, 1)
    expect(m.statusHistogram).toEqual({ 200: 3, 404: 1, 403: 1 })
    expect(m.failureGroups).toEqual([
      { status: '403', count: 1 },
      { status: '404', count: 1 },
    ])
    expect(m.failures).toEqual([
      { url: 'https://cdn/missing.jpg', status: 404, reason: 'HTTP 404', retried: false },
      { url: 'https://cdn/blocked.jpg', status: 403, reason: 'HTTP 403', retried: true },
    ])
  })

  it('treats an all-skipped run as 0% success and 0% rescue', () => {
    const m = classifyOutcomes([
      { kind: 'skipped', url: 'https://cdn/x.jpg', filename: 'x.jpg' },
      { kind: 'skipped', url: 'https://cdn/y.jpg', filename: 'y.jpg' },
    ])
    expect(m.ok).toBe(0)
    expect(m.failed).toBe(0)
    expect(m.successRate).toBe(0)
    expect(m.rescueRate).toBe(0)
  })
})

describe('detectLeaks', () => {
  it('flags non-image URLs mixed into the set', () => {
    const urls = [
      'https://re.bluepoch.com/home/detail.html',
      'https://cdn.com/a.jpg',
      'https://cdn.com/b.png',
      'https://cdn.com/c.webp?size=large',
      'https://cdn.com/favicon.ico',
    ]
    expect(detectLeaks(urls)).toEqual([
      'https://re.bluepoch.com/home/detail.html',
      'https://cdn.com/favicon.ico',
    ])
  })

  it('ignores query strings, hashes and uppercase extensions', () => {
    const urls = [
      'https://cdn.com/wallpaper.JPG?w=1920#top',
      'https://cdn.com/wallpaper.webp?token=abc123',
    ]
    expect(detectLeaks(urls)).toEqual([])
  })

  it('flags data: and blob: URIs as leaks', () => {
    expect(
      detectLeaks(['data:image/png;base64,AAA', 'blob:https://x/y', 'https://cdn.com/ok.jpg']),
    ).toEqual(['data:image/png;base64,AAA', 'blob:https://x/y'])
  })

  it('flags extension-less and directory URLs', () => {
    expect(detectLeaks(['https://cdn.com/somepath', 'https://cdn.com/folder/'])).toEqual([
      'https://cdn.com/somepath',
      'https://cdn.com/folder/',
    ])
  })
})

describe('buildRunReport', () => {
  const meta: RunMeta = {
    runId: '2026-08-06T10-00-00',
    startedAt: '2026-08-06T10:00:00.000Z',
    config: { BATCH_SIZE: 4, SESSION: 'bluepoch' },
  }
  const discovery: DiscoveryStats = {
    converged: false,
    stableRounds: 2,
    totalIdleSec: 31,
    networkCount: 900,
    domCount: 950,
    combinedCount: 970,
    thumbnailsClicked: 120,
    discoveryDurationMs: 600000,
    coverage: 0.09,
  }
  const outcomes: DownloadOutcome[] = [
    {
      kind: 'ok',
      url: 'https://cdn/a.jpg',
      filename: 'a.jpg',
      status: 200,
      retried: true,
      durationMs: 1000,
      bytes: 0,
    },
    {
      kind: 'failed',
      url: 'https://cdn/b.jpg',
      filename: 'b.jpg',
      status: 403,
      reason: 'HTTP 403',
      retried: true,
    },
  ]
  const metrics = classifyOutcomes(outcomes)
  const gallery: GalleryStats = {
    officialTotal: 1001,
    newSinceLastRun: 36,
    newFiles: ['1012.jpg'],
    firstRun: false,
    mirror: {
      missingFromDisk: { count: 1, files: ['1011.jpg'] },
      extraOnDisk: { count: 0, files: [] },
    },
  }
  const siteAssets = [
    'https://hm.baidu.com/hm.gif?rnd=1',
    'https://re.bluepoch.com/home/detail.html',
  ]

  it('computes duration and passes through discovery, download and gallery metrics', () => {
    const report = buildRunReport(meta, '2026-08-06T10:05:30.500Z', {
      discovery,
      metrics,
      gallery,
      leakedUrls: [],
      siteAssets: [],
      siteAssetFalsePositive: [],
    })
    expect(report.type).toBe('run_report')
    expect(report.runId).toBe('2026-08-06T10-00-00')
    expect(report.durationMs).toBe(330500)
    expect(report.discovery).toEqual(discovery)
    expect(report.download).toEqual(metrics)
    expect(report.gallery).toEqual(gallery)
    expect(report.siteAssets).toEqual({ count: 0, urls: [] })
    expect(report.failures).toEqual(metrics.failures)
  })

  it('records the filtered site assets so the capture is auditable', () => {
    const report = buildRunReport(meta, '2026-08-06T10:05:30.500Z', {
      discovery,
      metrics,
      gallery,
      leakedUrls: [],
      siteAssets,
      siteAssetFalsePositive: [],
    })
    expect(report.siteAssets).toEqual({ count: 2, urls: siteAssets })
  })

  it('derives defects from discovery, metrics, leaked URLs and the gallery check', () => {
    const report = buildRunReport(meta, '2026-08-06T10:05:30.500Z', {
      discovery,
      metrics,
      gallery,
      leakedUrls: ['https://re.bluepoch.com/home/detail.html'],
      siteAssets,
      siteAssetFalsePositive: ['https://cdn/PICTURE/20260907/1012.jpg'],
    })
    expect(report.defects).toEqual({
      discoveryLeak: { count: 1, urls: ['https://re.bluepoch.com/home/detail.html'] },
      nonConverged: true,
      emptyResult: false,
      persistentFailures: 1,
      emptyFiles: ['a.jpg'],
      siteAssetFalsePositive: {
        count: 1,
        urls: ['https://cdn/PICTURE/20260907/1012.jpg'],
      },
      gallerySourceUnavailable: false,
      mirrorGap: { missing: 1, extra: 0 },
    })
  })

  it('reports an unreachable gallery list as unknown instead of a number', () => {
    const report = buildRunReport(meta, '2026-08-06T10:05:30.500Z', {
      discovery: { ...discovery, coverage: null },
      metrics,
      gallery: {
        officialTotal: null,
        newSinceLastRun: null,
        newFiles: [],
        firstRun: false,
        mirror: null,
      },
      leakedUrls: ['https://re.bluepoch.com/home/detail.html'],
      siteAssets,
      siteAssetFalsePositive: null,
    })
    expect(report.gallery.officialTotal).toBeNull()
    expect(report.defects.gallerySourceUnavailable).toBe(true)
    expect(report.defects.mirrorGap).toBeNull()
    // Not checked is not the same as checked-and-clean.
    expect(report.defects.siteAssetFalsePositive).toBeNull()
  })

  it('flags emptyResult when nothing was found', () => {
    const report = buildRunReport(meta, '2026-08-06T10:01:00.000Z', {
      discovery,
      metrics: classifyOutcomes([]),
      gallery,
      leakedUrls: [],
      siteAssets: [],
      siteAssetFalsePositive: [],
    })
    expect(report.defects.emptyResult).toBe(true)
  })
})
