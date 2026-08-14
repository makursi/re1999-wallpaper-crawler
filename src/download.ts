import type { Logger } from 'pino'
import type { DownloadOutcome } from './report.js'
import { Buffer } from 'node:buffer'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fetch } from 'undici'
import { BASE_ORIGIN, IMAGE_EXTENSIONS, PAGE_URL, USER_AGENT } from './config.js'

// ── error carrying an HTTP status ──────────────────────────────────

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`)
  }
}

// ── cookie extraction ──────────────────────────────────────────────

let _cachedCookieHeader = ''

export function extractCookies(
  pwc: (args: string, timeoutSec?: number) => string,
): string {
  try {
    const raw = pwc('cookie-list', 15)
    const cookies: string[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('[') || trimmed.startsWith('─'))
        continue
      const parts = trimmed.split(/\s+/)
      if (parts.length >= 2) {
        cookies.push(`${parts[0]}=${parts[1]}`)
      }
    }
    _cachedCookieHeader = cookies.join('; ')
    return _cachedCookieHeader
  }
  catch {
    return ''
  }
}

function getCookieHeader(): string {
  return _cachedCookieHeader
}

// ── URL utilities ──────────────────────────────────────────────────

export function getFilenameFromUrl(url: string): string {
  const withoutQuery = url.split('?')[0].split('#')[0]
  const segments = withoutQuery.split('/')
  let raw = segments[segments.length - 1] || 'image'
  try {
    raw = decodeURIComponent(raw)
  }
  catch {}

  const dotIdx = raw.lastIndexOf('.')
  if (dotIdx !== -1) {
    const ext = raw.substring(dotIdx).toLowerCase()
    if (IMAGE_EXTENSIONS.includes(ext))
      return raw
  }
  // No recognized extension — leave as-is
  return raw
}

export function resolveUrl(url: string, base: string): string {
  return new URL(url, base).href
}

// ── download with fetch ────────────────────────────────────────────

export async function downloadFile(
  url: string,
  dest: string,
  referer: string,
): Promise<{ status: number, retried: boolean }> {
  const cookieHeader = getCookieHeader()

  async function doRequest(retry: boolean): Promise<{ status: number, retried: boolean }> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Referer': referer,
    }
    if (cookieHeader)
      headers.Cookie = cookieHeader

    if (retry) {
      Object.assign(headers, {
        'Accept':
          'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
      })
    }

    const response = await fetch(url, { headers, redirect: 'follow' })

    if (response.status === 403 && !retry) {
      return doRequest(true)
    }

    if (!response.ok) {
      throw new HttpError(response.status)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(dest, buffer)
    return { status: response.status, retried: retry }
  }

  return doRequest(false)
}

// ── batch download ─────────────────────────────────────────────────

export async function downloadOne(
  url: string,
  destDir: string,
  _logger: Logger,
): Promise<DownloadOutcome> {
  const absUrl = resolveUrl(url, BASE_ORIGIN)
  const filename = getFilenameFromUrl(absUrl)
  const dest = path.join(destDir, filename)

  if (fs.existsSync(dest)) {
    return { kind: 'skipped', url: absUrl, filename }
  }

  const start = Date.now()
  try {
    const { status, retried } = await downloadFile(absUrl, dest, PAGE_URL)
    const bytes = fs.statSync(dest).size
    return {
      kind: 'ok',
      url: absUrl,
      filename,
      status,
      retried,
      durationMs: Date.now() - start,
      bytes,
    }
  }
  catch (err) {
    const status = err instanceof HttpError ? err.status : undefined
    return {
      kind: 'failed',
      url: absUrl,
      filename,
      reason: String(err),
      status,
      // a failed 403 means the retry was attempted and still failed
      retried: status === 403 ? true : undefined,
      durationMs: Date.now() - start,
    }
  }
}

export async function downloadBatch(
  urls: string[],
  destDir: string,
  batchSize: number,
  logger: Logger,
): Promise<DownloadOutcome[]> {
  const outcomes: DownloadOutcome[] = []
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize)
    const results = await Promise.all(
      batch.map(async (url) => {
        const outcome = await downloadOne(url, destDir, logger)
        switch (outcome.kind) {
          case 'ok':
            logger.debug(
              { url: outcome.url, status: outcome.status, retried: outcome.retried, bytes: outcome.bytes },
              `[OK] ${outcome.filename}`,
            )
            break
          case 'skipped':
            logger.debug({ url: outcome.url }, `[SKIP] ${outcome.filename}`)
            break
          case 'failed':
            logger.warn(
              { url: outcome.url, status: outcome.status, retried: outcome.retried, reason: outcome.reason },
              `[FAIL] ${outcome.filename}`,
            )
            break
        }
        return outcome
      }),
    )
    outcomes.push(...results)
  }
  return outcomes
}
