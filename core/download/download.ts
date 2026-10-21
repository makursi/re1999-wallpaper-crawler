import { Buffer } from 'node:buffer'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Logger } from 'pino'
import { fetch } from 'undici'

import { BASE_ORIGIN, USER_AGENT } from '../config.js'
import type { DownloadOutcome } from '../report/report.js'
import { wallpaperNameOf } from '../wallpaper-url.js'

// ── error carrying an HTTP status ──────────────────────────────────

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`)
  }
}

// ── the HTTP client, injected ──────────────────────────────────────
//
// The real client is undici's `fetch`; a test passes a fake so the download
// contract (headers, the 403 retry, the outcome shape) is proved without a
// socket. The shape is the smallest part of `fetch` this module uses.

/** The response fields a download reads. */
export interface DownloadResponse {
  status: number
  ok: boolean
  arrayBuffer: () => Promise<ArrayBuffer>
}

/** The request a download makes: headers, and a followed redirect. */
export interface DownloadRequest {
  headers: Record<string, string>
  redirect: 'follow'
}

/** The HTTP client Download calls. `undici`'s `fetch` is one. */
export type DownloadFetch = (url: string, request: DownloadRequest) => Promise<DownloadResponse>

// ── URL utilities ──────────────────────────────────────────────────

export function getFilenameFromUrl(url: string): string {
  // Same basename the Gallery mirror check compares against, with a fallback
  // for URLs that carry no name at all.
  return wallpaperNameOf(url) || 'image'
}

export function resolveUrl(url: string, base: string): string {
  return new URL(url, base).href
}

// ── download with fetch ────────────────────────────────────────────
//
// No session: the Gallery list and the CDN both answer anonymously (ADR 0006),
// so a download carries no Cookie header and has no browser to borrow one from
// (#76). The 403 retry stays — it is the CDN's header policy, not auth.

export async function downloadFile(
  url: string,
  dest: string,
  referer: string,
  fetchImpl: DownloadFetch = fetch,
): Promise<{ status: number; retried: boolean }> {
  async function doRequest(retry: boolean): Promise<{ status: number; retried: boolean }> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Referer: referer,
    }

    if (retry) {
      Object.assign(headers, {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
      })
    }

    const response = await fetchImpl(url, { headers, redirect: 'follow' })

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
  fetchImpl: DownloadFetch = fetch,
): Promise<DownloadOutcome> {
  const absUrl = resolveUrl(url, BASE_ORIGIN)
  const filename = getFilenameFromUrl(absUrl)
  const dest = path.join(destDir, filename)

  if (fs.existsSync(dest)) {
    return { kind: 'skipped', url: absUrl, filename }
  }

  const start = Date.now()
  try {
    const { status, retried } = await downloadFile(absUrl, dest, BASE_ORIGIN, fetchImpl)
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
  } catch (err) {
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
  fetchImpl: DownloadFetch = fetch,
): Promise<DownloadOutcome[]> {
  const outcomes: DownloadOutcome[] = []
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize)
    const results = await Promise.all(
      batch.map(async url => {
        const outcome = await downloadOne(url, destDir, logger, fetchImpl)
        switch (outcome.kind) {
          case 'ok':
            logger.debug(
              {
                url: outcome.url,
                status: outcome.status,
                retried: outcome.retried,
                bytes: outcome.bytes,
              },
              `[OK] ${outcome.filename}`,
            )
            break
          case 'skipped':
            logger.debug({ url: outcome.url }, `[SKIP] ${outcome.filename}`)
            break
          case 'failed':
            logger.warn(
              {
                url: outcome.url,
                status: outcome.status,
                retried: outcome.retried,
                reason: outcome.reason,
              },
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
