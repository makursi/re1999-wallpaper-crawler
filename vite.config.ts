import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: `${here}web`,
  // Relative asset URLs: the built index.html is served from `/` by the
  // Console's own http service, which appends its token to each emitted asset
  // URL (src/console/server.ts › sendPage).
  base: './',
  plugins: [vue()],
  build: { outDir: `${here}dist`, emptyOutDir: true },
  // `dev:web` only: the service must already be running on 8791, and GETs carry
  // no Origin, so the guard admits them without an extra allowed origin.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8791', changeOrigin: true } } },
})
