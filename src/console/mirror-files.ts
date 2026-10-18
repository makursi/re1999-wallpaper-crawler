// ── Resolving a Wallpaper's file, safely ────────────────────────────
//
// The HTTP routes receive a *name* out of a URL, and a URL is attacker-shaped
// input: `%2e%2e%2f` survives WHATWG URL parsing, `path.join` will happily walk
// out of the Mirror, and Windows is case-insensitive so `existsSync` accepts a
// casing the listing never returned. This module is the one place that turns a
// name into a path, so the whole attack corpus is testable without a server
// (spec decision 25).
//
// The decisive check is exact-string membership in the Mirror's own listing:
// a name `readdirSync` did not produce cannot be opened, whatever it contains.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { isWallpaperFile } from '../wallpaper-url.js'

/** Why a name was refused. The route maps all of them to its own answers. */
export const MIRROR_REFUSALS = {
  malformedEncoding: 'malformed percent-encoding',
  empty: 'empty name',
  dotSegment: 'dot segment',
  separator: 'path separator in the name',
  nul: 'NUL byte in the name',
  colon: 'drive letter or alternate data stream',
  nonImage: 'not an image name',
  dotfile: 'dotfile name',
  notListed: 'not a name the Mirror listing contains',
  notAFile: 'not a regular file',
} as const

export type MirrorRefusal = (typeof MIRROR_REFUSALS)[keyof typeof MIRROR_REFUSALS]

export type MirrorResolution = { ok: true; path: string } | { ok: false; reason: MirrorRefusal }

/**
 * The Mirror file a URL name refers to, or the reason it is refused.
 *
 * Ordering is deliberate. `decodeURIComponent` runs **once** — decoding twice
 * would let a double-encoded separator through after the checks below it — and
 * every syntactic refusal comes before the listing lookup, so an attack is
 * rejected for its shape rather than merely for not being found. The listing is
 * read once per call: the Console reads a directory that a Run may be writing,
 * and a stale second read could disagree with the first.
 */
export function resolveMirrorFile(
  imagesDir: string,
  rawName: string,
  allowed: ReadonlySet<string> = mirrorNames(imagesDir),
): MirrorResolution {
  let name: string
  try {
    name = decodeURIComponent(rawName)
  } catch {
    return { ok: false, reason: MIRROR_REFUSALS.malformedEncoding }
  }

  if (name.length === 0) return { ok: false, reason: MIRROR_REFUSALS.empty }
  if (name === '.' || name === '..') return { ok: false, reason: MIRROR_REFUSALS.dotSegment }
  if (name.includes('/') || name.includes('\\')) {
    return { ok: false, reason: MIRROR_REFUSALS.separator }
  }
  if (name.includes('\0')) return { ok: false, reason: MIRROR_REFUSALS.nul }
  // A colon is a drive letter (`C:evil.jpg`) or an NTFS alternate data stream
  // (`<valid>:ads`), and no Wallpaper name contains one.
  if (name.includes(':')) return { ok: false, reason: MIRROR_REFUSALS.colon }
  if (name.startsWith('.')) return { ok: false, reason: MIRROR_REFUSALS.dotfile }
  if (!isWallpaperFile(name)) return { ok: false, reason: MIRROR_REFUSALS.nonImage }

  // DECISIVE: the listing's exact strings. `existsSync` would accept a case
  // variant on Windows and a name that only differs by trailing dot or space.
  if (!allowed.has(name)) return { ok: false, reason: MIRROR_REFUSALS.notListed }

  const target = path.resolve(imagesDir, name)
  // Defence in depth: with checks 4–5 passed this cannot fire, and if one of
  // them is ever weakened it is the line that still holds.
  if (path.dirname(target) !== path.resolve(imagesDir)) {
    return { ok: false, reason: MIRROR_REFUSALS.separator }
  }

  let stats: fs.Stats
  try {
    stats = fs.statSync(target)
  } catch {
    return { ok: false, reason: MIRROR_REFUSALS.notListed }
  }
  return stats.isFile()
    ? { ok: true, path: target }
    : { ok: false, reason: MIRROR_REFUSALS.notAFile }
}

/** The Mirror's entry names; a Mirror that is not there holds nothing. */
export function mirrorNames(imagesDir: string): Set<string> {
  try {
    return new Set(fs.readdirSync(imagesDir))
  } catch {
    return new Set()
  }
}
