// ── types ──────────────────────────────────────────────────────────

export type DownloadOutcome
  = | { kind: 'ok', url: string, filename: string, status: number, retried: boolean, durationMs: number, bytes: number }
    | { kind: 'skipped', url: string, filename: string }
    | { kind: 'failed', url: string, filename: string, reason: string, status?: number, retried?: boolean, durationMs?: number }

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
  failureGroups: { status: string, count: number }[]
  failures: { url: string, status?: number, reason: string, retried: boolean }[]
}

export interface DiscoveryStats {
  converged: boolean
  stableRounds: number
  totalIdleSec: number
  networkCount: number
  domCount: number
  combinedCount: number
  thumbnailsClicked: number
  discoveryDurationMs: number
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
  defects: {
    discoveryLeak: { count: number, urls: string[] }
    nonConverged: boolean
    emptyResult: boolean
    persistentFailures: number
    emptyFiles: string[]
  }
  failures: { url: string, status?: number, reason: string, retried: boolean }[]
}

// ── pure analysis helpers ──────────────────────────────────────────

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

export function detectLeaks(urls: string[]): string[] {
  return urls.filter(u => !isImageUrl(u))
}

function isImageUrl(url: string): boolean {
  const lower = url.toLowerCase()
  if (lower.startsWith('data:') || lower.startsWith('blob:'))
    return false
  const path = lower.split('?')[0].split('#')[0]
  return IMAGE_EXTENSIONS.some(ext => path.endsWith(ext))
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

    if (o.retried)
      metrics.retryTotal++

    if (o.kind === 'ok') {
      metrics.ok++
      metrics.totalBytes += o.bytes
      okDurations.push(o.durationMs)
      if (o.bytes === 0) {
        metrics.emptyFiles++
        metrics.emptyFilenames.push(o.filename)
      }
      if (o.retried)
        metrics.retryRescued++
      bump(hist, String(o.status))
    }
    else {
      metrics.failed++
      metrics.failures.push({
        url: o.url,
        status: o.status,
        reason: o.reason,
        retried: o.retried ?? false,
      })
      if (o.retried)
        metrics.persistentFailures++
      if (o.status != null) {
        bump(hist, String(o.status))
        bump(failHist, String(o.status))
      }
    }
  }

  const attempted = metrics.ok + metrics.failed
  metrics.successRate = attempted > 0 ? metrics.ok / attempted : 0
  metrics.rescueRate = metrics.retryTotal > 0 ? metrics.retryRescued / metrics.retryTotal : 0
  metrics.avgDownloadMs = okDurations.length > 0
    ? okDurations.reduce((s, d) => s + d, 0) / okDurations.length
    : 0

  metrics.statusHistogram = hist
  metrics.failureGroups = Object.entries(failHist)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status))

  return metrics
}

function bump(hist: Record<string, number>, status: string): void {
  hist[status] = (hist[status] ?? 0) + 1
}

export function buildRunReport(
  meta: RunMeta,
  finishedAt: string,
  discovery: DiscoveryStats,
  metrics: DownloadMetrics,
  leakedUrls: string[],
): RunReport {
  return {
    type: 'run_report',
    runId: meta.runId,
    startedAt: meta.startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(meta.startedAt)),
    discovery,
    download: metrics,
    defects: {
      discoveryLeak: { count: leakedUrls.length, urls: leakedUrls },
      nonConverged: !discovery.converged,
      emptyResult: metrics.total === 0,
      persistentFailures: metrics.persistentFailures,
      emptyFiles: metrics.emptyFilenames,
    },
    failures: metrics.failures,
  }
}
