import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The page's build config, at the web layer's root: `here` is the layer root,
// because this file is where a standard Vite project keeps it. The built page
// lands beside the config (`web/dist`), which is where the Console looks for it:
// the service's `distDir` is `<web layer root>/dist` as well, and the two names
// are the same directory — `DIST_DIR_NAME` in `web/server/console-config.ts` and
// the literal below. Nothing links them at compile time, so the smoke run is what
// proves they agree: the Console builds the page here and then serves it.
const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: here,
  // Relative asset URLs: the built index.html is served from `/` by the
  // Console's own http service, which appends its token to each emitted asset
  // URL (web/server/server.ts › sendPage).
  base: './',
  plugins: [vue()],
  build: { outDir: `${here}dist`, emptyOutDir: true },
  // `dev:web` only: the service must already be running on 8791, and GETs carry
  // no Origin, so the guard admits them without an extra allowed origin.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8791', changeOrigin: true } } },
})
