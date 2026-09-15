import { describe, expect, it } from 'vitest'

import {
  classifySiteAsset,
  describeSiteAssetRules,
  isImageUrl,
  isSiteAsset,
  isWallpaperFile,
  splitWallpaperUrls,
  wallpaperNameOf,
} from '../src/wallpaper-url.js'

const WALLPAPER =
  'https://gamecms-res.sl916.com/official_website_resource/50001/4/PICTURE/20260907/1012.%E7%AB%96%E7%89%88-2560x1440_5e7b2726dd044c39a526651bbebe75e6.jpg'

describe('isImageUrl', () => {
  it('accepts image extensions, with query strings and hashes', () => {
    expect(isImageUrl('https://cdn.com/a.jpg')).toBe(true)
    expect(isImageUrl('https://cdn.com/a.JPG?w=1920#top')).toBe(true)
    expect(isImageUrl('https://cdn.com/a.webp?token=abc')).toBe(true)
    expect(isImageUrl(WALLPAPER)).toBe(true)
  })

  it('rejects data:, blob: and extension-less URLs', () => {
    expect(isImageUrl('data:image/png;base64,AAA')).toBe(false)
    expect(isImageUrl('blob:https://x/y')).toBe(false)
    expect(isImageUrl('https://re.bluepoch.com/home/detail.html')).toBe(false)
    expect(isImageUrl('https://cdn.com/folder/')).toBe(false)
  })
})

describe('classifySiteAsset', () => {
  it('leaves real Wallpapers alone', () => {
    expect(classifySiteAsset(WALLPAPER)).toBeNull()
    expect(isSiteAsset(WALLPAPER)).toBe(false)
  })

  it('marks the page HTML as a non-image asset', () => {
    expect(classifySiteAsset('https://re.bluepoch.com/home/detail.html')?.kind).toBe('nonImage')
  })

  it('marks the analytics pixel by host, whatever its query string', () => {
    const a = classifySiteAsset('https://hm.baidu.com/hm.gif?hca=01CBE5B6&rnd=1993810578')
    const b = classifySiteAsset('https://hm.baidu.com/hm.gif?hca=01CBE5B6&rnd=1204024030')
    expect(a?.kind).toBe('host')
    expect(b?.kind).toBe('host')
  })

  it('marks site UI art by path prefix', () => {
    expect(classifySiteAsset('https://re.bluepoch.com/home/img/BG2.png')?.kind).toBe('pathPrefix')
    expect(classifySiteAsset('https://re.bluepoch.com/home/img/music/1.png')?.reason).toContain(
      'UI art',
    )
    expect(
      classifySiteAsset('https://re.bluepoch.com/home/img/music/Vinyl%20record.png')?.kind,
    ).toBe('pathPrefix')
  })

  it('marks the site icon by filename prefix', () => {
    const icon =
      'https://gamecms-res.sl916.com/official_website_resource/50001/4/GAME_PIC/20230327/icon-192_0e1a4a1085404e98a024506fc4b7c2f6.png'
    expect(classifySiteAsset(icon)?.kind).toBe('filenamePrefix')
  })

  it('marks the site UI icons by exact filename', () => {
    // These are the names the discovery script used to drop in its own
    // untested filter; they belong to the same decision, so they moved here.
    expect(classifySiteAsset('https://re.bluepoch.com/static/pre.png')?.kind).toBe('filenameIn')
    expect(classifySiteAsset('https://re.bluepoch.com/static/logo.png?x=1')?.kind).toBe(
      'filenameIn',
    )
    expect(classifySiteAsset('https://re.bluepoch.com/static/PRE.PNG')?.kind).toBe('filenameIn')
  })

  it('does not mark a Wallpaper whose name only resembles an icon name', () => {
    expect(classifySiteAsset('https://cdn.com/PICTURE/20260907/1012.pre.png')).toBeNull()
  })

  it('does not mark same-host resources outside the asset paths', () => {
    expect(classifySiteAsset('https://re.bluepoch.com/home/other/pic.jpg')).toBeNull()
  })

  it('explains the rule list for the run_meta snapshot', () => {
    const described = describeSiteAssetRules()
    expect(described).toContain('host:hm.baidu.com')
    expect(described).toContain('pathPrefix:/home/img/')
    expect(described).toContain('filenamePrefix:icon-')
    expect(described).toContain('filenameIn:pre.png')
    expect(described).toContain('nonImage')
  })
})

describe('wallpaperNameOf', () => {
  it('returns the decoded basename Download writes to disk', () => {
    expect(wallpaperNameOf(WALLPAPER)).toBe(
      '1012.竖版-2560x1440_5e7b2726dd044c39a526651bbebe75e6.jpg',
    )
    expect(wallpaperNameOf('https://cdn.com/a%20b.jpg?w=1920#top')).toBe('a b.jpg')
  })

  it('returns an empty name for a URL ending in a slash', () => {
    expect(wallpaperNameOf('https://cdn.com/folder/')).toBe('')
    expect(wallpaperNameOf('https://cdn.com/folder')).toBe('folder')
  })

  it('leaves a malformed escape sequence alone instead of throwing', () => {
    expect(wallpaperNameOf('https://cdn.com/%E0%A4%A.jpg')).toBe('%E0%A4%A.jpg')
  })
})

describe('isWallpaperFile', () => {
  it('accepts the extensions the CDN serves, case-insensitively', () => {
    expect(isWallpaperFile('1012.竖版-2560x1440_5e7b.jpg')).toBe(true)
    expect(isWallpaperFile('161 1125x2436_7ab568b5.jpeg')).toBe(true)
    expect(isWallpaperFile('x.WEBP')).toBe(true)
  })

  it('rejects non-image files and extension-less names', () => {
    expect(isWallpaperFile('detail.html')).toBe(false)
    expect(isWallpaperFile('README')).toBe(false)
    expect(isWallpaperFile('.jpg')).toBe(false)
    expect(isWallpaperFile('.gallery-state.json')).toBe(false)
  })
})

describe('splitWallpaperUrls', () => {
  it('partitions the capture, preserving order', () => {
    const urls = [
      WALLPAPER,
      'https://hm.baidu.com/hm.gif?rnd=1',
      'https://re.bluepoch.com/home/detail.html',
      'https://gamecms-res.sl916.com/official_website_resource/50001/4/PICTURE/20260907/1011.jpg',
    ]
    const { wallpapers, siteAssets } = splitWallpaperUrls(urls)
    expect(wallpapers).toEqual([
      WALLPAPER,
      'https://gamecms-res.sl916.com/official_website_resource/50001/4/PICTURE/20260907/1011.jpg',
    ])
    expect(siteAssets).toHaveLength(2)
  })

  it('handles an empty capture', () => {
    expect(splitWallpaperUrls([])).toEqual({ wallpapers: [], siteAssets: [] })
  })
})
