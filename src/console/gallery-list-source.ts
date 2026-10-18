// ── The Gallery list, read once and shared ──────────────────────────
//
// Both `GET /api/status` (its `officialTotal` / `listAvailable`) and
// `GET /api/gallery` (the whole row set) need the site's list, and the page
// polls — so the service reads it once and serves the same answer inside a TTL
// instead of hammering the endpoint on every request (spec decision 19).
//
// A failed read is cached too, as `null`: `null` is the contract's "not read"
// (ADR 0006), and a broken endpoint must not get one request per poll. The
// `GallerySourceError` is absorbed here, at the Console's own fetch site,
// exactly as `src/main.ts:172-183` absorbs it for a Run.

import type { GalleryList } from '../gallery/gallery-source.js'

export interface GalleryListSource {
  /** The list, or `null` for "not read" — which is never "empty". */
  get(): Promise<GalleryList | null>
}

export interface GalleryListSourceOptions {
  /** `fetchGalleryList` bound to the endpoint; it throws `GallerySourceError`. */
  fetchList: () => Promise<GalleryList>
  /** How long one read (successful or not) answers for. */
  ttlMs?: number
  /** Injected so the TTL needs no real clock. */
  now?: () => number
}

const DEFAULT_TTL_MS = 60_000

export function createGalleryListSource({
  fetchList,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now,
}: GalleryListSourceOptions): GalleryListSource {
  let cached: { value: GalleryList | null; expiresAt: number } | null = null

  return {
    async get(): Promise<GalleryList | null> {
      const at = now()
      if (cached !== null && at < cached.expiresAt) return cached.value

      let value: GalleryList | null
      try {
        value = await fetchList()
      } catch {
        // Every refusal mode is a `GallerySourceError`; at this boundary it
        // means "the list was not read", which is cached like a read so a
        // polling page cannot hammer a broken endpoint.
        value = null
      }
      cached = { value, expiresAt: now() + ttlMs }
      return value
    },
  }
}
