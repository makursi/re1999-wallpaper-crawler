// ── Download's contract, without a browser or a session (#76) ──────
//
// Download used to reuse the Browser session's cookies. The Gallery list and the
// CDN both answer anonymously (ADR 0006), so the cookie path is gone and what
// remains is the contract these tests pin: UA + Referer, one 403 retry with full
// browser headers, and the outcome shape `classifyOutcomes` reads.
//
// Everything is injected — a fake fetch and a temporary directory — so no test
// reaches the network or the repository's Mirror.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { pino } from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'

// `core/download/download.ts` imports `core/config.ts`, which validates the
// environment at import time — and a CI checkout has no `.env`.
vi.hoisted(() => {
  process.env.BASE_ORIGIN ??= 'https://re.bluepoch.com'
})

import { BASE_ORIGIN } from '../../../core/config.js'
import type { DownloadFetch } from '../../../core/download/download.js'
import { downloadBatch, downloadFile, downloadOne } from '../../../core/download/download.js'

const CDN = 'https://gamecms-res.sl916.com/official_website_resource/50001/4/PICTURE'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'download-'))
  roots.push(root)
  return root
}

interface Call {
  url: string
  headers: Record<string, string>
}

/** A fake fetch that records what it was asked for and answers from a script. */
function scripted(...statuses: number[]): { fetchImpl: DownloadFetch; calls: Call[] } {
  const calls: Call[] = []
  let round = 0
  const fetchImpl: DownloadFetch = async (url, init) => {
    calls.push({ url, headers: init.headers })
    const status = statuses[Math.min(round++, statuses.length - 1)]
    return new Response('bytes', { status })
  }
  return { fetchImpl, calls }
}

describe('downloadFile', () => {
  it('sends the UA and Referer and no Cookie header, and writes the bytes', async () => {
    const dest = path.join(scratch(), 'a.jpg')
    const { fetchImpl, calls } = scripted(200)

    const result = await downloadFile(`${CDN}/20260907/1012.jpg`, dest, BASE_ORIGIN, fetchImpl)

    expect(result).toEqual({ status: 200, retried: false })
    expect(fs.readFileSync(dest, 'utf8')).toBe('bytes')
    expect(calls[0].url).toBe(`${CDN}/20260907/1012.jpg`)
    expect(calls[0].headers['User-Agent']).toContain('Mozilla/5.0')
    expect(calls[0].headers.Referer).toBe(BASE_ORIGIN)
    // #76: the session is gone, so a download carries nothing a browser would.
    expect(calls[0].headers).not.toHaveProperty('Cookie')
  })

  it('retries a 403 once with the full browser headers and no Cookie', async () => {
    const dest = path.join(scratch(), 'a.jpg')
    const { fetchImpl, calls } = scripted(403, 200)

    const result = await downloadFile(`${CDN}/20260907/1012.jpg`, dest, BASE_ORIGIN, fetchImpl)

    expect(result).toEqual({ status: 200, retried: true })
    expect(calls).toHaveLength(2)
    // The retry escalates the browser-ish headers the CDN rejects minimal
    // requests for; it does not re-add a session that no longer exists.
    expect(calls[1].headers).toMatchObject({
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site',
    })
    expect(calls[1].headers.Accept).toContain('image/avif')
    expect(calls[1].headers).not.toHaveProperty('Cookie')
    expect(fs.readFileSync(dest, 'utf8')).toBe('bytes')
  })

  it('does not retry a non-403 failure, and leaves no file behind', async () => {
    const dest = path.join(scratch(), 'a.jpg')
    const { fetchImpl, calls } = scripted(404)

    await expect(
      downloadFile(`${CDN}/20260907/1012.jpg`, dest, BASE_ORIGIN, fetchImpl),
    ).rejects.toThrow(/HTTP 404/)
    expect(calls).toHaveLength(1)
    expect(fs.existsSync(dest)).toBe(false)
  })
})

describe('downloadOne', () => {
  const logger = pino({ level: 'silent' })

  it('skips a file already on disk without asking the network', async () => {
    const dir = scratch()
    fs.writeFileSync(path.join(dir, '1012.jpg'), 'already here', 'utf8')
    let calls = 0
    const fetchImpl: DownloadFetch = async () => {
      calls++
      return new Response('bytes', { status: 200 })
    }

    const outcome = await downloadOne(`${CDN}/20260907/1012.jpg`, dir, logger, fetchImpl)

    expect(outcome).toEqual({
      kind: 'skipped',
      url: `${CDN}/20260907/1012.jpg`,
      filename: '1012.jpg',
    })
    expect(calls).toBe(0)
  })

  it('reports a failure that survived the 403 retry as retried', async () => {
    const dir = scratch()
    const { fetchImpl, calls } = scripted(403, 403)

    const outcome = await downloadOne(`${CDN}/20260907/1012.jpg`, dir, logger, fetchImpl)

    expect(calls).toHaveLength(2)
    expect(outcome).toMatchObject({
      kind: 'failed',
      filename: '1012.jpg',
      status: 403,
      retried: true,
    })
    // `classifyOutcomes` reads `retried` to count persistent failures.
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('resolves a relative URL against the site origin', async () => {
    const dir = scratch()
    const { fetchImpl, calls } = scripted(200)

    const outcome = await downloadOne('/pictures/1012.jpg', dir, logger, fetchImpl)

    expect(calls[0].url).toBe(`${BASE_ORIGIN}/pictures/1012.jpg`)
    expect(outcome).toMatchObject({ kind: 'ok', url: `${BASE_ORIGIN}/pictures/1012.jpg` })
  })
})

describe('downloadBatch', () => {
  const logger = pino({ level: 'silent' })

  it('keeps going after a failure and classifies each outcome', async () => {
    const dir = scratch()
    const { fetchImpl } = scripted(200, 404)

    const outcomes = await downloadBatch(
      [`${CDN}/20260907/1012.jpg`, `${CDN}/20260907/1011.jpg`],
      dir,
      1,
      logger,
      fetchImpl,
    )

    expect(outcomes.map(outcome => outcome.kind)).toEqual(['ok', 'failed'])
    expect(fs.readdirSync(dir)).toEqual(['1012.jpg'])
  })
})
