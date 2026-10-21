// ── Discovery: the Gallery list is the Wallpaper URL set (#76) ─────
//
// The gallery page renders a handful of thumbnails at a time, so capturing its
// traffic saw 18–45% of the gallery. The site's own list endpoint answers the
// whole question in one unauthenticated request (ADR 0006), so a Run's Discovery
// is that request: every entry's `pictureUrl`, in the list's order.
//
// Site asset rules (`core/wallpaper-url.ts`) stay the vocabulary for "is this a
// Wallpaper", but no longer sit on the Run's path — the list is the authority on
// what a Wallpaper is, and a captured URL no longer exists to filter.

import { falsePositivesAmong } from '../gallery/gallery-source.js'
import type { GalleryList } from '../gallery/gallery-source.js'
import type { CaptureAudit, DiscoveryStats } from '../report/report.js'

/** What one Run's Discovery produced. */
export interface DiscoveryResult {
  /** The Wallpaper URL set Download consumes; empty when the list was unavailable. */
  urls: string[]
  /** The report's `discovery` block, kept in its existing shape. */
  stats: DiscoveryStats
  /**
   * The report's capture audit, kept in its existing shape. A Run has no capture
   * any more, so it is always empty; `siteAssetFalsePositive` is `[]` when the
   * list was read (there was no dropped URL to test) and `null` when it was not.
   */
  capture: CaptureAudit
}

/**
 * The Discovery block of a Run that could not read the list. It is not "nothing
 * was found": the source never answered, which the report carries as
 * `coverage: null` and the Run's `gallerySourceUnavailable` defect.
 */
function unavailableStats(durationMs: number): DiscoveryStats {
  return {
    converged: false,
    stableRounds: 0,
    totalIdleSec: 0,
    networkCount: 0,
    domCount: 0,
    combinedCount: 0,
    thumbnailsClicked: 0,
    discoveryDurationMs: durationMs,
    coverage: null,
  }
}

/**
 * Turn the Gallery list into the Run's Discovery. `durationMs` is how long the
 * list request took, which is the only phase time a Run still has.
 */
export function discoverFromList(list: GalleryList | null, durationMs: number): DiscoveryResult {
  // Nothing was captured, so nothing could leak and nothing was dropped. The
  // Site asset check still runs over that empty drop list, in the same function
  // the browser-era Run used: `[]` when the list was read, `null` when it was
  // not — the value the run-log reader ties to the Mirror gap.
  const capture: CaptureAudit = {
    leakedUrls: [],
    siteAssets: [],
    siteAssetFalsePositive: falsePositivesAmong([], list),
  }

  if (list === null) {
    return { urls: [], stats: unavailableStats(durationMs), capture }
  }

  const urls = [...new Set(list.entries.map(entry => entry.url))]

  return {
    urls,
    stats: {
      // The request that carries the whole inventory either completed or did
      // not. There is no settling loop left for convergence to describe.
      converged: true,
      stableRounds: 0,
      totalIdleSec: 0,
      // The one response carried every entry; nothing was read from a DOM. Both
      // counters count URLs, as they always did, so a repeated URL counts once.
      networkCount: urls.length,
      domCount: 0,
      combinedCount: urls.length,
      // No thumbnails were clicked: there is no page.
      thumbnailsClicked: 0,
      discoveryDurationMs: durationMs,
      // The URL set *is* the list, so the coverage gate reads 1 by construction.
      coverage: 1,
    },
    capture,
  }
}
