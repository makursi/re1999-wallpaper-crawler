// ── Thumbnails: one pinned size, generated on demand ───────────────
//
// A Gallery tile is a Wallpaper's longest edge at 400 px, aspect preserved,
// generated the first time it is asked for and cached by the Wallpaper's own
// name afterwards (spec decisions 22–24; docs/adr/0010).
//
// The cache lives OUTSIDE the Mirror: `.console-cache/thumbnails/` at the
// repository root, which is what keeps the Mirror gap — the one number the page
// is for — independent of where the Console puts its files. The name is the key
// because a Wallpaper's name embeds a content hash, so a cache hit needs no
// invalidation (notes 02 §6).
//
// This is the image library's ONLY import site, and the import is dynamic on
// purpose: the native addon loads during module evaluation in 0.35.5, so a
// broken or absent binary arrives as a rejected `await import('sharp')` — a
// named 500 at the request site, never a crashed process and never a failed
// Run. Nothing under `src/` outside this file may import it (spec decision 26;
// .console-notes/00-conventions.md §1).

import * as fs from 'node:fs'
import * as path from 'node:path'

/** The pinned size: the longest edge, in pixels (spec decision 23). */
export const THUMBNAIL_MAX_EDGE = 400

/** The cache's directory name, relative to the repository root (ADR 0010). */
export const THUMBNAIL_CACHE_DIR_NAME = path.join('.console-cache', 'thumbnails')

/**
 * The image library's own work: read `sourcePath`, write a thumbnail to
 * `targetFile`. Injected so a test can count generations, or refuse, without
 * touching a real image.
 */
export type ThumbnailGenerator = (sourcePath: string, targetFile: string) => Promise<void>

/**
 * The filesystem touches, isolated so a test can substitute them. `writeFile`
 * is expected to be atomic (write beside the target, then rename): a request
 * that fails mid-generation must not leave a partial thumbnail that every later
 * request would serve as a cache hit.
 */
export interface ThumbnailCache {
  exists: (file: string) => boolean
  ensureDir: (dir: string) => void
  writeFile: (file: string, bytes: Buffer) => void
}

export interface ThumbnailOptions {
  /** The Mirror the source is read from. Read only. */
  imagesDir: string
  /** The cache root — `.console-cache/thumbnails` under the project root. */
  cacheDir: string
  generate: ThumbnailGenerator
  cache: ThumbnailCache
}

/**
 * The thumbnail's path in the cache, whether or not it is there yet.
 *
 * The cache directory itself is created lazily, so asking for a path never
 * touches the disk.
 */
export function thumbnailPathOf(cacheDir: string, name: string): string {
  return path.join(cacheDir, name)
}

/**
 * One thumbnail: the cached file when it is already there, the generated one
 * otherwise. The cache key is the Wallpaper's name, which embeds the content
 * hash, so a hit is never stale and the source is not re-read.
 */
export async function ensureThumbnail(name: string, options: ThumbnailOptions): Promise<string> {
  const { imagesDir, cacheDir, generate, cache } = options
  const target = thumbnailPathOf(cacheDir, name)
  if (cache.exists(target)) return target

  // Lazily, and only on a miss: a cache hit never touches the directory.
  cache.ensureDir(cacheDir)
  const source = path.join(imagesDir, name)
  await generate(source, target)
  return target
}

/**
 * The pinned call, verified by measurement (notes 02 §5): `fit: 'inside'` fits
 * within a 400×400 box and preserves aspect, so the longest edge is exactly 400
 * with no orientation branch; `withoutEnlargement` guards a source smaller than
 * the pin. The output format follows the target file's extension, so the
 * source's extension is preserved by the caller's name.
 */
export const realThumbnailGenerator: ThumbnailGenerator = async (sourcePath, targetFile) => {
  const { default: sharp } = await import('sharp')
  await sharp(sourcePath)
    .resize({
      width: THUMBNAIL_MAX_EDGE,
      height: THUMBNAIL_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toFile(targetFile)
}

/** The real filesystem, with the atomic write the cache contract asks for. */
export const realThumbnailCache: ThumbnailCache = {
  exists: file => fs.existsSync(file),
  ensureDir: dir => fs.mkdirSync(dir, { recursive: true }),
  writeFile: (file, bytes) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const pending = `${file}.pending-${process.pid}-${Date.now()}`
    try {
      fs.writeFileSync(pending, bytes)
      fs.renameSync(pending, file)
    } catch (error) {
      fs.rmSync(pending, { force: true })
      throw error
    }
  },
}
