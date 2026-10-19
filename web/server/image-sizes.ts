// ── A Wallpaper's own pixel size ────────────────────────────────────
//
// The gallery wall is masonry (#48): a tile is placed in the column that is
// shortest at the time it arrives, and that cannot be decided without the
// tile's height for the column's width. A tile that only learns its height
// after the image loads re-balances the whole wall under the reader's cursor,
// which is why the number has to come from the file rather than from the
// browser. The Mirror's files are the only source, and this module is the
// reading of them: a bounded, failure-tolerant pass over the rows, plus the
// per-process memo that makes the second request free.
//
// Nothing here touches a file: `fileOf` and `sizeOf` are injected, so the
// collector's behaviour — a skipped name, a reader that throws, the
// concurrency ceiling — is testable without an image on disk. The real reader
// lives beside the image library's only other import site
// (`web/server/thumbnails.ts`), and the memo is built in the composition root
// (`web/server/console.ts`), because it has to outlive a request.

import type { ConsoleImageSize } from '../api-types.js'

/** One file's own pixel size. Rejects when the file cannot be measured. */
export type ImageSizeReader = (file: string) => Promise<ConsoleImageSize>

/**
 * One reader, remembered per file, for the life of the process.
 *
 * The Mirror's names embed a content hash, so a hit is never stale — the same
 * reasoning as the thumbnail cache (ADR 0010), without the disk. Concurrent
 * asks for the same file share one read rather than starting two. Only a
 * *successful* read is remembered: a file that could not be measured (it
 * vanished, or the image library is broken) is retried on the next request
 * instead of being pinned as unmeasurable for the session.
 */
export function createImageSizeCache(read: ImageSizeReader): ImageSizeReader {
  const sizes = new Map<string, ConsoleImageSize>()
  const inFlight = new Map<string, Promise<ConsoleImageSize>>()

  return async file => {
    const measured = sizes.get(file)
    if (measured !== undefined) return measured
    const pending = inFlight.get(file)
    if (pending !== undefined) return pending

    const started = read(file).then(size => {
      sizes.set(file, size)
      return size
    })
    inFlight.set(file, started)
    try {
      return await started
    } finally {
      inFlight.delete(file)
    }
  }
}

/**
 * How many files are measured at once. Measured on this workspace's Mirror
 * (1013 JPEGs, 1440 × 2560 and 2436 × 1125 in equal parts): a sequential pass
 * takes 5.0 s and a pass at this ceiling takes 1.2 s, warm or cold, with no
 * gain from going wider — the header read is already disk-bound.
 */
export const IMAGE_SIZE_CONCURRENCY = 8

/**
 * The sizes of the names that stand for a file, by name.
 *
 * A name `fileOf` refuses (not in the Mirror's listing, not an image name) and
 * a file `sizeOf` cannot measure are both simply absent from the result. That
 * is deliberate and it is the whole failure policy: the page's fallback for an
 * unknown tile is a proportion, so a miss costs a slightly less exact column
 * and never a broken wall, a 500, or a `0 × 0` tile.
 */
export async function imageSizesOf(
  names: readonly string[],
  fileOf: (name: string) => string | null,
  sizeOf: ImageSizeReader,
  concurrency = IMAGE_SIZE_CONCURRENCY,
): Promise<Record<string, ConsoleImageSize>> {
  const targets: { name: string; file: string }[] = []
  for (const name of names) {
    const file = fileOf(name)
    if (file !== null) targets.push({ name, file })
  }

  const sizes: Record<string, ConsoleImageSize> = {}
  let next = 0
  const workers = Math.max(1, Math.min(concurrency, targets.length))
  await Promise.all(
    Array.from({ length: workers }, async () => {
      // No `await` between reading the cursor and advancing it, so two workers
      // can never claim the same name.
      while (next < targets.length) {
        const { name, file } = targets[next++]
        try {
          sizes[name] = await sizeOf(file)
        } catch {
          // Not measurable: a text file, a file that vanished since the
          // listing, or a broken native addon. The tile falls back.
        }
      }
    }),
  )
  return sizes
}
