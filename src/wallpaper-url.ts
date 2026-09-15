// ── The Wallpaper URL set: the Discovery → Download join ────────────
//
// Discovery captures every image request the SPA makes, and some of those are
// not Wallpapers: the page's own HTML, analytics pixels, and the site's UI art
// (background, music-player covers, icons). This module is the single place
// that decides which captured URL is a Wallpaper, so Discovery's output and
// Download's input cannot drift apart.

export const IMAGE_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

export interface SiteAssetRule {
  kind: 'nonImage' | 'host' | 'pathPrefix' | 'filenamePrefix'
  value?: string
  reason: string
}

// Site assets observed in the capture, marked so they are never downloaded
// again. Rules are structural (host / path / filename prefix) rather than
// exact filenames, because analytics pixel URLs carry per-request query
// strings and icon filenames embed a build hash. See docs/adr/0004.
export const SITE_ASSET_RULES: readonly SiteAssetRule[] = [
  {
    kind: 'nonImage',
    reason: "not an image URL (the page's own HTML document)",
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

function filenameOf(url: string): string {
  const withoutQuery = url.split('?')[0].split('#')[0]
  const segments = withoutQuery.split('/')
  const raw = segments[segments.length - 1] ?? ''
  try {
    return decodeURIComponent(raw).toLowerCase()
  } catch {
    return raw.toLowerCase()
  }
}

function matchesRule(rule: SiteAssetRule, url: string): boolean {
  switch (rule.kind) {
    case 'nonImage':
      return !isImageUrl(url)
    case 'host':
      return urlOf(url)?.host.toLowerCase() === rule.value
    case 'pathPrefix':
      return (
        urlOf(url)
          ?.pathname.toLowerCase()
          .startsWith(rule.value ?? '') ?? false
      )
    case 'filenamePrefix':
      return filenameOf(url).startsWith(rule.value ?? '')
    default: {
      // Unreachable: `kind` is an exhaustive union. The assignment fails to
      // compile if a new kind is added without a case above.
      const unhandled: never = rule.kind
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
  return SITE_ASSET_RULES.map(rule =>
    rule.value !== undefined ? `${rule.kind}:${rule.value}` : rule.kind,
  ).join(' ')
}
