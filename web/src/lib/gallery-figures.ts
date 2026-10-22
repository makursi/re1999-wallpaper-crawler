// ── The one figures line (#94) ──────────────────────────────────────
//
// `Gallery N · downloaded N · missing N`, plus `· extra N` when the Mirror holds
// any retired files, or "Gallery unread" when the list was not read. The wall's
// header and the Run panel both render it, from this one computation, so the
// two cannot print 1001 above 1013.
//
// `downloaded` is "the official entries whose file is on disk" — the complement
// of the gap over the Gallery total — and never the Mirror's count. The Mirror
// also holds files the site has retired; those are extras, not downloads, and
// counting them would make the line stop adding up.
//
// A pure function: the payload arrives as data, so the page and the tests feed
// it the same way. `null` is "nothing read yet"; the figures of an unread list
// are all `null`, which is what the header renders as "Gallery unread".

import type { ConsoleGalleryPayload } from '../../api-types.js'

/** The payload fields the figures read. */
export type GalleryFiguresSource = Pick<ConsoleGalleryPayload, 'officialTotal' | 'mirrorGap'>

/** The four counts of the one line; every one is a data cell in the copy. */
export interface GalleryFigures {
  /** What the Gallery list says the gallery holds; `null` = not read. */
  officialTotal: number | null
  /** The official entries whose file is on disk. */
  downloaded: number | null
  /** The gap: the list's names the disk does not hold. */
  missing: number | null
  /** The gap: the disk's names the list does not hold. */
  extra: number | null
}

/**
 * The figures of one gallery payload, or `null` when the page has not read one
 * yet. An unread list is not the same thing: it has a payload, all of whose
 * counts are `null`, and the header says "Gallery unread" for it.
 */
export function galleryFiguresOf(gallery: GalleryFiguresSource | null): GalleryFigures | null {
  if (gallery === null) return null
  const { officialTotal, mirrorGap } = gallery
  if (officialTotal === null || mirrorGap === null) {
    return { officialTotal: null, downloaded: null, missing: null, extra: null }
  }
  return {
    officialTotal,
    // The gap is the Run report's set arithmetic, so its complement over the
    // Gallery total is the official entries on disk: downloaded + missing is
    // the Gallery total by construction, in both locales and every reading.
    downloaded: officialTotal - mirrorGap.missing,
    missing: mirrorGap.missing,
    extra: mirrorGap.extra,
  }
}
