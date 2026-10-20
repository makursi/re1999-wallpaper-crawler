// ── GET /api/status ─────────────────────────────────────────────────
//
// The page's one read: the Run half from the Run log directory, the Gallery half
// from the cached list, and the Mirror's count. The route gathers; `buildStatus`
// decides.
//
// `runConfigAvailable` is read now, not at boot (#60): a `.env` created since
// the service started has to clear the page's setup notice on this read, and
// the entry point injects the same one-file check the start's `env-file` refusal
// makes, so the ambient notice and the click path cannot disagree. The fallback
// is #57's boot fact for a service given no reader.

import type { Hono } from 'hono'

import type { ServiceRuntime } from '../http/deps.js'
import { expectMethod } from '../http/method.js'
import { json } from '../http/respond.js'
import { countMirrorWallpapers } from '../mirror.js'
import { buildStatus } from '../status.js'

export function registerStatusRoute(app: Hono, runtime: ServiceRuntime): void {
  const { config, deps } = runtime

  app.all('/api/status', expectMethod('GET'), async () =>
    json(
      200,
      buildStatus({
        run: deps.runState(),
        mirrorCount: countMirrorWallpapers(config.imagesDir),
        gallery: await deps.galleryFacts(),
        runConfigAvailable: deps.runConfigAvailable?.() ?? config.galleryListEndpoint !== null,
      }),
    ),
  )
}
