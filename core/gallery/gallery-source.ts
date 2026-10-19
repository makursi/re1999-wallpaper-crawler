// ── The Gallery list: the site's own inventory of Wallpapers ────────
//
// The gallery page renders a handful of thumbnails at a time, so the browser
// capture sees a subset of the gallery. The site's own list endpoint answers
// the whole question in one request: every entry, with the id the gallery
// numbers it by, plus the total. It is the authoritative Wallpaper URL set,
// and it needs no session. See docs/adr/0006.

import { z } from 'zod'

import { wallpaperNameOf } from '../wallpaper-url.js'

export interface GalleryEntry {
  /** The gallery's own id for the entry; stable across re-encodes. */
  id: number
  url: string
}

export interface GalleryList {
  /** What the source says the gallery holds. */
  total: number
  entries: GalleryEntry[]
}

export class GallerySourceError extends Error {
  override name = 'GallerySourceError'
}

const payloadSchema = z.object({
  code: z.number(),
  data: z.object({
    total: z.number().int().nonnegative(),
    pageData: z.array(
      z.object({
        id: z.number().int(),
        // The payload also carries `title`, which is null for 225 of the 1001
        // entries and disagrees with the id for 625 of them. Not worth keeping.
        pictureUrl: z.string().min(1),
      }),
    ),
  }),
})

export interface GallerySourceOptions {
  endpoint: string
  fetchImpl?: typeof globalThis.fetch
  timeoutMs?: number
}

/** One request asks for the whole gallery; the site has never served more. */
const GALLERY_LIST_PAGE_SIZE = 2000

const REQUEST_HEADERS = {
  'content-type': 'application/json',
  'x-requested-with': 'XMLHttpRequest',
}

/**
 * Ask the site for its gallery list. Every failure is a `GallerySourceError`:
 * the caller reports the source as unavailable rather than guessing at the
 * numbers (see docs/adr/0006).
 */
export async function fetchGalleryList({
  endpoint,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
}: GallerySourceOptions): Promise<GalleryList> {
  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body: JSON.stringify({ current: 1, pageSize: GALLERY_LIST_PAGE_SIZE }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new GallerySourceError(`list endpoint unreachable: ${message(error)}`)
  }

  if (!response.ok) {
    throw new GallerySourceError(`list endpoint answered HTTP ${response.status}`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new GallerySourceError(`list endpoint sent unreadable JSON: ${message(error)}`)
  }

  return parseGalleryList(payload)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Parse a list response, refusing anything that cannot be trusted as complete. */
export function parseGalleryList(payload: unknown): GalleryList {
  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new GallerySourceError(`unexpected list payload: ${parsed.error.message}`)
  }
  if (parsed.data.code !== 200) {
    throw new GallerySourceError(`list endpoint answered code ${parsed.data.code}`)
  }

  const { total, pageData } = parsed.data.data
  if (pageData.length !== total) {
    // A short page means the response was paginated or capped: a partial list
    // would silently report Wallpapers as missing and new.
    throw new GallerySourceError(`incomplete list: ${pageData.length} of ${total} entries`)
  }

  return {
    total,
    entries: pageData.map(entry => ({ id: entry.id, url: entry.pictureUrl })),
  }
}

/** The names the Mirror check and the filter check both key on. */
export function officialNamesOf(list: GalleryList): Set<string> {
  return new Set(list.entries.map(entry => wallpaperNameOf(entry.url)))
}

/**
 * The dropped URLs the list calls Wallpapers — a rule that swallowed one. `null`
 * when the list was unavailable, because "not checked" is not "nothing wrong".
 */
export function falsePositivesAmong(
  dropped: readonly string[],
  list: GalleryList | null,
): string[] | null {
  if (list === null) return null
  const officialNames = officialNamesOf(list)
  return dropped.filter(url => officialNames.has(wallpaperNameOf(url)))
}
