// ── The update check: one decision, one request ─────────────────────
//
// #81: the page may learn that a newer release exists, and nothing else. The
// decision is a pure function of three inputs — the version this Console is, the
// newest release the project publishes, and the Releases page to link to — so
// every "should this show, and what does it say" case is pinned here without a
// network, a clock or a `.env`.
//
// The fetch is the second seam: injected, so a test can hand it a response, a
// rejection or a signal that never settles, and assert that every one of them
// arrives as "no notice" rather than as an error, a retry or a thrown promise.

import { describe, expect, it } from 'vitest'

import type { LatestRelease } from '../../../web/server/update-check.js'
import {
  RELEASES_PAGE_URL,
  checkForUpdate,
  fetchLatestRelease,
  updateNoticeFor,
} from '../../../web/server/update-check.js'

/** A published release, as GitHub describes it. */
function release(over: Partial<LatestRelease> = {}): LatestRelease {
  return { tagName: 'v1.2.3', draft: false, prerelease: false, ...over }
}

/** The decision, from the three inputs the module takes. */
function noticeFor(currentVersion: string | null, latest: LatestRelease | null) {
  return updateNoticeFor({
    currentVersion,
    latestRelease: latest,
    releasesUrl: RELEASES_PAGE_URL,
  })
}

describe('the update decision', () => {
  it('names a newer release and the page that lists it', () => {
    expect(noticeFor('1.0.0', release())).toEqual({
      version: '1.2.3',
      releasesUrl: RELEASES_PAGE_URL,
    })
  })

  it('offers only the version and the link — no download, no mirror', () => {
    // The notice is data, not a call to action: the shape itself is the promise
    // that the page cannot grow a download button from this payload.
    expect(Object.keys(noticeFor('1.0.0', release()) ?? {}).toSorted()).toEqual([
      'releasesUrl',
      'version',
    ])
  })

  it('says nothing when the newest release is the version already running', () => {
    expect(noticeFor('1.2.3', release())).toBeNull()
    // The tag's `v` is notation, not a different version.
    expect(noticeFor('1.2.3', release({ tagName: '1.2.3' }))).toBeNull()
    expect(noticeFor('v1.2.3', release({ tagName: 'v1.2.3' }))).toBeNull()
  })

  it('says nothing when the newest release is older', () => {
    expect(noticeFor('1.2.3', release({ tagName: 'v1.2.2' }))).toBeNull()
    expect(noticeFor('2.0.0', release({ tagName: 'v1.99.99' }))).toBeNull()
  })

  it('orders by each number, not by the text', () => {
    // The comparison the page must not do lexically: "1.10.0" is newer than
    // "1.9.0", and "1.0.10" than "1.0.9".
    expect(noticeFor('1.9.0', release({ tagName: 'v1.10.0' }))?.version).toBe('1.10.0')
    expect(noticeFor('1.0.9', release({ tagName: 'v1.0.10' }))?.version).toBe('1.0.10')
    expect(noticeFor('1.10.0', release({ tagName: 'v1.9.0' }))).toBeNull()
  })

  it('says nothing when the current version is unknown', () => {
    // #79's `null` is "no version to report", never "everything is outdated".
    expect(noticeFor(null, release())).toBeNull()
  })

  it('says nothing when the check learned no release', () => {
    expect(noticeFor('1.0.0', null)).toBeNull()
  })

  it('says nothing for a draft or a prerelease', () => {
    // A draft is the release a human is smoke-testing; a prerelease is not
    // something a player should be told to install.
    expect(noticeFor('1.0.0', release({ draft: true }))).toBeNull()
    expect(noticeFor('1.0.0', release({ prerelease: true }))).toBeNull()
  })

  it.each([
    ['not a version', 'latest'],
    ['two numbers', '1.2'],
    ['four numbers', '1.2.3.4'],
    ['a prerelease suffix', 'v1.2.3-beta.1'],
    ['a build suffix', 'v1.2.3+build.7'],
    ['a date-style tag', 'release-2026-10-21'],
    ['empty', ''],
  ])('says nothing when the tag is %s', (_case, tagName) => {
    expect(noticeFor('1.0.0', release({ tagName }))).toBeNull()
  })

  it('says nothing when the current version itself is unreadable', () => {
    // An install carrying `package.json`'s version is the normal path, but a
    // value this module cannot compare is not a licence to guess.
    expect(noticeFor('development', release())).toBeNull()
  })
})

/** A GitHub release body, only the fields this module reads. */
function releaseBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { tag_name: 'v1.2.3', draft: false, prerelease: false, ...over }
}

/** A response shaped like GitHub's. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A fetch that never answers until its signal aborts, as a hung host behaves. */
async function hangingFetch(
  _input: Parameters<typeof globalThis.fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  const signal = init?.signal
  return new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener('abort', () =>
      reject(new DOMException('This operation was aborted', 'AbortError')),
    )
  })
}

/** The URL a fetch call was made for, whatever shape it passed it as. */
function requestedUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** A fetch that records what it was asked, and answers what the test says. */
function recordingFetch(answer: () => Promise<Response>): {
  fetchImpl: typeof fetch
  calls: { url: string; init: RequestInit | undefined }[]
} {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fetchImpl = async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    calls.push({ url: requestedUrl(input), init })
    return answer()
  }
  return { fetchImpl, calls }
}

describe('reading the newest release', () => {
  it('keeps the tag and the two flags that decide whether to announce it', async () => {
    const { fetchImpl } = recordingFetch(async () => jsonResponse(releaseBody()))

    expect(await fetchLatestRelease({ fetchImpl })).toEqual({
      tagName: 'v1.2.3',
      draft: false,
      prerelease: false,
    })
  })

  it('asks GitHub’s newest-release endpoint once, anonymously', async () => {
    const { fetchImpl, calls } = recordingFetch(async () => jsonResponse(releaseBody()))

    await fetchLatestRelease({ fetchImpl })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      'https://api.github.com/repos/makursi/re1999-wallpaper-crawler/releases/latest',
    )
    // Anonymous: no token can ship in a client, and the repository is public.
    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('accept')).toBe('application/vnd.github+json')
    // A redirect is not followed: the API's answer has to be the API's answer.
    expect(calls[0].init?.redirect).toBe('error')
    // The timeout is on the request itself, so nothing can hang the boot.
    expect(calls[0].init?.signal).toBeDefined()
  })

  it.each([404, 500, 403])('collapses an HTTP %i answer to no release', async status => {
    const { fetchImpl } = recordingFetch(async () => jsonResponse({ message: 'nope' }, status))

    expect(await fetchLatestRelease({ fetchImpl })).toBeNull()
  })

  it('collapses an unreadable body to no release', async () => {
    const { fetchImpl } = recordingFetch(
      async () => new Response('<!doctype html>', { status: 200 }),
    )

    expect(await fetchLatestRelease({ fetchImpl })).toBeNull()
  })

  it.each([
    ['no tag', releaseBody({ tag_name: undefined })],
    ['a blank tag', releaseBody({ tag_name: '   ' })],
    ['a numeric tag', releaseBody({ tag_name: 123 })],
    ['not an object', 'v1.2.3'],
    ['null', null],
  ])('collapses a payload with %s to no release', async (_case, body) => {
    const { fetchImpl } = recordingFetch(async () => jsonResponse(body))

    expect(await fetchLatestRelease({ fetchImpl })).toBeNull()
  })

  it.each([
    ['a string draft flag', releaseBody({ draft: 'false' })],
    ['a missing prerelease flag', releaseBody({ prerelease: undefined })],
  ])('collapses a payload with %s rather than guessing', async (_case, body) => {
    // GitHub documents both flags as booleans. A payload that does not carry
    // them is not one this module understands, and "not understood" must never
    // read as "not a draft".
    const { fetchImpl } = recordingFetch(async () => jsonResponse(body))

    expect(await fetchLatestRelease({ fetchImpl })).toBeNull()
  })

  it('collapses an unreachable host — DNS, offline — to no release', async () => {
    const { fetchImpl } = recordingFetch(async () => {
      throw new TypeError('fetch failed')
    })

    expect(await fetchLatestRelease({ fetchImpl })).toBeNull()
  })

  it('collapses a redirect to no release', async () => {
    // What the real `fetch` does under `redirect: 'error'`.
    const { fetchImpl } = recordingFetch(async () => {
      throw new TypeError('unexpected redirect')
    })

    expect(await fetchLatestRelease({ fetchImpl })).toBeNull()
  })

  it('collapses a request that does not answer in time', async () => {
    expect(await fetchLatestRelease({ fetchImpl: hangingFetch, timeoutMs: 10 })).toBeNull()
  })

  it('does not retry a failed request', async () => {
    const { fetchImpl, calls } = recordingFetch(async () => jsonResponse({}, 500))

    await fetchLatestRelease({ fetchImpl })

    expect(calls).toHaveLength(1)
  })
})

describe('checking once per boot', () => {
  it('turns a newer release into the notice the status carries', async () => {
    expect(
      await checkForUpdate({
        currentVersion: '1.0.0',
        fetchRelease: async () => release(),
      }),
    ).toEqual({ version: '1.2.3', releasesUrl: RELEASES_PAGE_URL })
  })

  it('turns a failed check into no notice rather than an error', async () => {
    // The whole failure family arrives here as one `null`; nothing upstream has
    // an error to report, retry or log.
    const notice = await checkForUpdate({
      currentVersion: '1.0.0',
      fetchRelease: async () => null,
    })

    expect(notice).toBeNull()
  })

  it('does not ask GitHub when there is no version to compare', async () => {
    let asked = false
    const notice = await checkForUpdate({
      currentVersion: null,
      fetchRelease: async () => {
        asked = true
        return release()
      },
    })

    expect(notice).toBeNull()
    expect(asked).toBe(false)
  })

  it('swallows a fetch implementation that throws', async () => {
    // The real fetch collapses its own failures, but this promise is awaited
    // during boot: it may not reject even for an injected implementation.
    const notice = await checkForUpdate({
      currentVersion: '1.0.0',
      fetchRelease: async () => {
        throw new Error('network down')
      },
    })

    expect(notice).toBeNull()
  })
})
