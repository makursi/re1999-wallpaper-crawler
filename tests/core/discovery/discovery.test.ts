// ── Discovery from the Gallery list (#76) ──────────────────────────
//
// A Run used to render the page and capture image traffic. The list endpoint
// already carries every `pictureUrl`, so Discovery became one request: these
// tests pin what that means for the Run's URL set and for the report fields the
// browser capture used to fill.

import { describe, expect, it } from 'vitest'

import { discoverFromList } from '../../../core/discovery/discovery.js'
import type { GalleryList } from '../../../core/gallery/gallery-source.js'

const CDN = 'https://gamecms-res.sl916.com/official_website_resource/50001/4/PICTURE'

function listOf(urls: readonly string[]): GalleryList {
  return { total: urls.length, entries: urls.map((url, i) => ({ id: 1000 + i, url })) }
}

describe('discoverFromList', () => {
  it('makes every pictureUrl in the list the Run’s Wallpaper URL set', () => {
    const urls = [`${CDN}/20260907/1012.jpg`, `${CDN}/20260907/1011.jpg`]

    expect(discoverFromList(listOf(urls), 160).urls).toEqual(urls)
  })

  // The report's browser-capture counters are kept — `check-run`, the Console
  // and the run-log readers consume them — and re-pointed at the list, which is
  // what actually carries those numbers now.
  it('reports the list’s counters as the report’s Discovery block', () => {
    const urls = [`${CDN}/20260907/1012.jpg`, `${CDN}/20260907/1011.jpg`]

    expect(discoverFromList(listOf(urls), 160).stats).toEqual({
      // One request that carries the whole inventory either completed or did
      // not; there is no settling loop left whose rounds could be counted.
      converged: true,
      stableRounds: 0,
      totalIdleSec: 0,
      // The list response carried every entry, and nothing came from a DOM.
      networkCount: 2,
      domCount: 0,
      combinedCount: 2,
      // No thumbnails were clicked: there is no page.
      thumbnailsClicked: 0,
      discoveryDurationMs: 160,
      // The URL set *is* the list, so the coverage gate reads 1 by construction.
      coverage: 1,
    })
  })

  it('reports an unavailable list as no URLs and an unknown coverage', () => {
    // There is no capture to fall back on any more: without the list a Run has
    // nothing to download, and the report says so instead of guessing.
    const result = discoverFromList(null, 25)

    expect(result.urls).toEqual([])
    expect(result.stats).toEqual({
      converged: false,
      stableRounds: 0,
      totalIdleSec: 0,
      networkCount: 0,
      domCount: 0,
      combinedCount: 0,
      thumbnailsClicked: 0,
      discoveryDurationMs: 25,
      coverage: null,
    })
  })

  it('has no capture left to audit: nothing leaked, nothing filtered', () => {
    const listed = discoverFromList(listOf([`${CDN}/20260907/1012.jpg`]), 160)
    // The Site asset check is present-but-empty rather than `null`: the list was
    // read, so there was something to check, and the empty capture contains no
    // dropped URL that could be a Wallpaper. `null` stays reserved for the
    // unavailable list, the same way the Mirror gap uses it.
    expect(listed.capture).toEqual({ leakedUrls: [], siteAssets: [], siteAssetFalsePositive: [] })
    // Without the list there is nothing to check and nothing was checked.
    expect(discoverFromList(null, 25).capture.siteAssetFalsePositive).toBeNull()
  })

  it('does not run the Site asset rules over the list', () => {
    // `/home/img/` is a Site asset path for a browser capture (ADR 0004), but an
    // entry the site itself lists is a Wallpaper by definition (ADR 0006), so it
    // must reach Download.
    const listed = `${CDN}/20260907/1012.jpg`
    const uiLooking = 'https://re.bluepoch.com/home/img/background.jpg'

    expect(discoverFromList(listOf([listed, uiLooking]), 160).urls).toEqual([listed, uiLooking])
  })

  it('downloads a URL the list repeats only once', () => {
    const url = `${CDN}/20260907/1012.jpg`

    const result = discoverFromList(listOf([url, url]), 160)

    expect(result.urls).toEqual([url])
    expect(result.stats.combinedCount).toBe(1)
    expect(result.stats.networkCount).toBe(1)
  })
})
