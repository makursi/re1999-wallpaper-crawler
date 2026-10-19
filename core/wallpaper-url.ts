// ── The Wallpaper URL set: the Discovery → Download join ────────────
//
// Discovery captures every image request the SPA makes, and some of those are
// not Wallpapers: the page's own HTML, analytics pixels, and the site's UI art
// (background, music-player covers, icons). This module is the single place
// that decides which captured URL is a Wallpaper, so Discovery's output and
// Download's input cannot drift apart.

export const IMAGE_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/**
 * One reason a captured URL is a Site asset. Each kind carries exactly the
 * data it needs, so a rule cannot be written without its match value.
 */
export type SiteAssetRule =
  | { kind: 'nonImage'; reason: string }
  | { kind: 'host'; value: string; reason: string }
  | { kind: 'pathPrefix'; value: string; reason: string }
  | { kind: 'filenamePrefix'; value: string; reason: string }
  | { kind: 'filenameIn'; values: readonly string[]; reason: string }

// Site assets observed in the capture, marked so they are never downloaded
// again. Rules are structural (host / path / filename prefix) rather than
// exact filenames, because analytics pixel URLs carry per-request query
// strings and icon filenames embed a build hash. See docs/adr/0004.
export const SITE_ASSET_RULES: readonly SiteAssetRule[] = [
  {
    kind: 'nonImage',
    reason: "not an image URL we download (the page's own HTML, SVG art)",
  },
  {
    kind: 'host',
    value: 'hm.baidu.com',
    reason: 'Baidu Analytics tracking pixel (1x1 GIF)',
  },
  {
    kind: 'pathPrefix',
    value: '/home/img/',
    reason: 'site UI art (page background, music-player covers)',
  },
  {
    kind: 'filenamePrefix',
    value: 'icon-',
    reason: 'site icon / favicon',
  },
  {
    kind: 'filenameIn',
    // The UI chrome the Discovery script used to drop in its own untested
    // filter. Same decision, so it lives with the other rules now (ADR 0004).
    values: [
      'pre.png',
      'next.png',
      'star.png',
      'hide.png',
      'share.png',
      'menuc.png',
      'menu.png',
      'v2c.png',
      'b.png',
      's.png',
      'a.png',
      'd.png',
      'c.png',
      'pc.png',
      'z.png',
      'log.png',
      'logo.png',
      'wx.png',
      'age.png',
      'ageword.png',
      'agewordm.png',
      'cha.png',
      'v2.webp',
    ],
    reason: 'site UI chrome (nav arrows, player, share and age-gate icons)',
  },
]

export function isImageUrl(url: string): boolean {
  const lower = url.toLowerCase()
  if (lower.startsWith('data:') || lower.startsWith('blob:')) return false
  const path = lower.split('?')[0].split('#')[0]
  return IMAGE_EXTENSIONS.some(ext => path.endsWith(ext))
}

function urlOf(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * The basename Download writes to disk for a URL — decoded, query and hash
 * dropped. Both the Site asset rules and the Gallery mirror check key on it, so
 * "the same image" means the same string wherever it is compared.
 */
export function wallpaperNameOf(url: string): string {
  const withoutQuery = url.split('?')[0].split('#')[0]
  const segments = withoutQuery.split('/')
  const raw = segments[segments.length - 1] ?? ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** A downloaded Wallpaper file, as opposed to a Site asset that slipped in. */
export function isWallpaperFile(name: string): boolean {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  // `dot > 0` so a nameless dotfile like `.jpg` is not a Wallpaper
  return dot > 0 && IMAGE_EXTENSIONS.includes(lower.slice(dot))
}

function filenameOf(url: string): string {
  return wallpaperNameOf(url).toLowerCase()
}

function matchesRule(rule: SiteAssetRule, url: string): boolean {
  switch (rule.kind) {
    case 'nonImage':
      return !isImageUrl(url)
    case 'host':
      return urlOf(url)?.host.toLowerCase() === rule.value
    case 'pathPrefix':
      return urlOf(url)?.pathname.toLowerCase().startsWith(rule.value) ?? false
    case 'filenamePrefix':
      return filenameOf(url).startsWith(rule.value)
    case 'filenameIn':
      return rule.values.includes(filenameOf(url))
    default: {
      // Unreachable: `kind` is an exhaustive union. The assignment fails to
      // compile if a new kind is added without a case above.
      const unhandled: never = rule
      return unhandled
    }
  }
}

/** The rule that marks this URL as a Site asset, or `null` if it is a Wallpaper. */
export function classifySiteAsset(url: string): SiteAssetRule | null {
  for (const rule of SITE_ASSET_RULES) {
    if (matchesRule(rule, url)) return rule
  }
  return null
}

export function isSiteAsset(url: string): boolean {
  return classifySiteAsset(url) !== null
}

export function splitWallpaperUrls(urls: readonly string[]): {
  wallpapers: string[]
  siteAssets: string[]
} {
  const wallpapers: string[] = []
  const siteAssets: string[] = []
  for (const url of urls) {
    if (isSiteAsset(url)) siteAssets.push(url)
    else wallpapers.push(url)
  }
  return { wallpapers, siteAssets }
}

/** Compact rule list for the `run_meta` config snapshot (config-drift detection). */
export function describeSiteAssetRules(): string {
  return SITE_ASSET_RULES.map(describeRule).join(' ')
}

function describeRule(rule: SiteAssetRule): string {
  switch (rule.kind) {
    case 'nonImage':
      return rule.kind
    case 'filenameIn':
      return `${rule.kind}:${rule.values.join(',')}`
    case 'host':
    case 'pathPrefix':
    case 'filenamePrefix':
      return `${rule.kind}:${rule.value}`
    default: {
      // Same guard as matchesRule: a new kind must say how it prints.
      const unhandled: never = rule
      return unhandled
    }
  }
}
