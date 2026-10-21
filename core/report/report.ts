// ── types ──────────────────────────────────────────────────────────

import type { GalleryStats } from '../gallery/gallery-state.js'
import { isImageUrl } from '../wallpaper-url.js'

export type DownloadOutcome =
  | {
      kind: 'ok'
      url: string
      filename: string
      status: number
      retried: boolean
      durationMs: number
      bytes: number
    }
  | { kind: 'skipped'; url: string; filename: string }
  | {
      kind: 'failed'
      url: string
      filename: string
      reason: string
      status?: number
      retried?: boolean
      durationMs?: number
    }

export interface DownloadMetrics {
  total: number
  ok: number
  skipped: number
  failed: number
  successRate: number
  retryRescued: number
  retryTotal: number
  rescueRate: number
  emptyFiles: number
  emptyFilenames: string[]
  persistentFailures: number
  totalBytes: number
  avgDownloadMs: number
  statusHistogram: Record<string, number>
  failureGroups: { status: string; count: number }[]
  failures: { url: string; status?: number; reason: string; retried: boolean }[]
}

export interface DiscoveryStats {
  /**
   * Whether Discovery's one request completed. Since #76 Discovery is the
   * Gallery list, so this is `false` exactly when the list could not be read —
   * there is no settling loop whose rounds could leave it unconverged.
   */
  converged: boolean
  /** Always `0`: the list has no settling rounds (kept for the report's shape). */
  stableRounds: number
  /** Always `0`: no page was scrolled, so nothing idled (kept for the shape). */
  totalIdleSec: number
  /** The URLs the one list response carried (deduplicated). */
  networkCount: number
  /** Always `0`: no DOM exists any more (kept for the shape). */
  domCount: number
  /** The Wallpaper URL set the Run downloads — the list's own URLs. */
  combinedCount: number
  /** Always `0`: no thumbnail was clicked (kept for the shape). */
  thumbnailsClicked: number
  /** How long the list request took. */
  discoveryDurationMs: number
  /**
   * Share of the official list the Run's URL set contains. It is `1` whenever
   * the list was read — the URL set *is* the list, so the old screening number
   * (18–45% of the gallery, the gate for #76) has nothing left to measure — and
   * `null` when the list was unavailable. See docs/adr/0018.
   */
  coverage: number | null
}

export interface RunMeta {
  runId: string
  startedAt: string
  config: Record<string, string | number | boolean | undefined>
}

export interface RunReport {
  type: 'run_report'
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  discovery: DiscoveryStats
  download: DownloadMetrics
  gallery: GalleryStats
  /**
   * Site assets dropped before Download. A Run has no browser capture to filter
   * any more (#76), so this is always `{ count: 0, urls: [] }`; the section is
   * kept because `check-run`, the Console and the run-log readers consume it,
   * and the ADR records that it no longer varies (docs/adr/0018).
   */
  siteAssets: { count: number; urls: string[] }
  defects: {
    discoveryLeak: { count: number; urls: string[] }
    nonConverged: boolean
    emptyResult: boolean
    persistentFailures: number
    emptyFiles: string[]
    /**
     * `null` = not checked, because the list was unavailable. When the list was
     * read, the check is vacuously empty (`[]`): there is no dropped URL left
     * for a rule to have swallowed. The Run log reader ties this `null` to the
     * Mirror gap's, so it cannot be `null` while the Mirror was checked.
     */
    siteAssetFalsePositive: { count: number; urls: string[] } | null
    gallerySourceUnavailable: boolean
    mirrorGap: { missing: number; extra: number } | null
  }
  failures: { url: string; status?: number; reason: string; retried: boolean }[]
}

// ── pure analysis helpers ──────────────────────────────────────────

export function detectLeaks(urls: string[]): string[] {
  return urls.filter(u => !isImageUrl(u))
}

export function classifyOutcomes(outcomes: DownloadOutcome[]): DownloadMetrics {
  const metrics: DownloadMetrics = {
    total: outcomes.length,
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
  }

  const okDurations: number[] = []
  const hist: Record<string, number> = {}
  const failHist: Record<string, number> = {}

  for (const o of outcomes) {
    if (o.kind === 'skipped') {
      metrics.skipped++
      continue
    }

    if (o.retried) metrics.retryTotal++

    if (o.kind === 'ok') {
      metrics.ok++
      metrics.totalBytes += o.bytes
      okDurations.push(o.durationMs)
      if (o.bytes === 0) {
        metrics.emptyFiles++
        metrics.emptyFilenames.push(o.filename)
      }
      if (o.retried) metrics.retryRescued++
      bump(hist, String(o.status))
    } else {
      metrics.failed++
      metrics.failures.push({
        url: o.url,
        status: o.status,
        reason: o.reason,
        retried: o.retried ?? false,
      })
      if (o.retried) metrics.persistentFailures++
      if (o.status != null) {
        bump(hist, String(o.status))
        bump(failHist, String(o.status))
      }
    }
  }

  const attempted = metrics.ok + metrics.failed
  metrics.successRate = attempted > 0 ? metrics.ok / attempted : 0
  metrics.rescueRate = metrics.retryTotal > 0 ? metrics.retryRescued / metrics.retryTotal : 0
  metrics.avgDownloadMs =
    okDurations.length > 0 ? okDurations.reduce((s, d) => s + d, 0) / okDurations.length : 0

  metrics.statusHistogram = hist
  metrics.failureGroups = Object.entries(failHist)
    .map(([status, count]) => ({ status, count }))
    .toSorted((a, b) => b.count - a.count || a.status.localeCompare(b.status))

  return metrics
}

function bump(hist: Record<string, number>, status: string): void {
  hist[status] = (hist[status] ?? 0) + 1
}

/**
 * What one Run's Discovery produced. These travel together — from the list,
 * through the split, into the report — so they are passed as one value.
 *
 * Since #76 the audit describes an empty capture: a Run asks the Gallery list
 * and downloads it, so nothing was captured, nothing leaked and nothing was
 * dropped. The fields stay because the report's shape is a contract (ADR 0018).
 */
export interface CaptureAudit {
  leakedUrls: string[]
  siteAssets: string[]
  /** Site assets the official list calls Wallpapers; `null` when not checked. */
  siteAssetFalsePositive: string[] | null
}

export interface RunInputs extends CaptureAudit {
  discovery: DiscoveryStats
  metrics: DownloadMetrics
  gallery: GalleryStats
}

export function buildRunReport(
  meta: RunMeta,
  finishedAt: string,
  { discovery, metrics, gallery, leakedUrls, siteAssets, siteAssetFalsePositive }: RunInputs,
): RunReport {
  return {
    type: 'run_report',
    runId: meta.runId,
    startedAt: meta.startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(meta.startedAt)),
    discovery,
    download: metrics,
    gallery,
    siteAssets: { count: siteAssets.length, urls: siteAssets },
    defects: {
      discoveryLeak: { count: leakedUrls.length, urls: leakedUrls },
      nonConverged: !discovery.converged,
      emptyResult: metrics.total === 0,
      persistentFailures: metrics.persistentFailures,
      emptyFiles: metrics.emptyFilenames,
      siteAssetFalsePositive:
        siteAssetFalsePositive === null
          ? null
          : { count: siteAssetFalsePositive.length, urls: siteAssetFalsePositive },
      gallerySourceUnavailable: gallery.officialTotal === null,
      mirrorGap:
        gallery.mirror === null
          ? null
          : {
              missing: gallery.mirror.missingFromDisk.count,
              extra: gallery.mirror.extraOnDisk.count,
            },
    },
    failures: metrics.failures,
  }
}
