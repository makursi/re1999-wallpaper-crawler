// ── GET /api/gallery (#33, sizes #48) ───────────────────────────────
//
// The Gallery list read against the Mirror: one row per entry, the Mirror's
// extras after them, the gap as set arithmetic, and the newest Run's
// `newSinceLastRun`. All the deciding is in the pure `buildGalleryView`; this
// module only gathers its inputs.
//
// The rows' pixel sizes are the masonry's second input (#48): the wall deals
// tiles into the shortest column, and the measurement has to be the file's,
// because the page would only learn it once the lazy thumbnail arrived. The
// measuring runs against the one listing read below, so a name the Mirror no
// longer holds is skipped rather than opened.

import * as path from 'node:path'

import type { Hono } from 'hono'

import { isWallpaperFile } from '../../../core/wallpaper-url.js'
import { buildGalleryView, toGalleryPayload } from '../gallery-view.js'
import type { ServiceRuntime } from '../http/deps.js'
import { expectMethod } from '../http/method.js'
import { json } from '../http/respond.js'
import { imageSizesOf } from '../image-sizes.js'
import { countMirrorNames, readMirrorNames } from '../mirror.js'

export function registerGalleryRoute(app: Hono, runtime: ServiceRuntime): void {
  const { config, deps } = runtime

  app.all('/api/gallery', expectMethod('GET'), async () => {
    const list = deps.galleryList === undefined ? null : await deps.galleryList.get()
    // One read of the Mirror, so the rows and the count cannot describe two
    // different directories — and so the sizes are measured against exactly the
    // names those rows came from.
    const diskFiles = readMirrorNames(config.imagesDir)
    const view = buildGalleryView({
      list,
      diskFiles,
      newSinceLastRun: deps.newSinceLastRun?.() ?? null,
    })
    const sizeSource = deps.imageSizeSource
    // The listing as a set: one membership test per row, not one scan per row.
    const listed = new Set(diskFiles)
    const sizes =
      sizeSource === undefined
        ? {}
        : await imageSizesOf(
            // Only a row with a file can be measured: a `missing` row is a
            // Gallery entry the Mirror does not hold.
            view.rows.filter(row => row.state !== 'missing').map(row => row.name),
            name => mirrorFilePath(config.imagesDir, listed, name),
            sizeSource,
          )
    return json(200, toGalleryPayload(view, countMirrorNames(diskFiles), sizes))
  })
}

/**
 * The file a gallery row's name stands for, or `null` when the Mirror would not
 * serve it (#48).
 *
 * The same decisive check the image routes make — exact membership in the
 * listing the rows were built from, plus an image name — without the URL
 * decoding those routes need: this name came out of the listing, not out of a
 * URL, so it is already the file's own name and a `%` in it is a `%`.
 */
function mirrorFilePath(
  imagesDir: string,
  listed: ReadonlySet<string>,
  name: string,
): string | null {
  return listed.has(name) && isWallpaperFile(name) ? path.join(imagesDir, name) : null
}
