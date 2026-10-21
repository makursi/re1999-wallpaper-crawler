import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'

// The page's build config, at the web layer's root: `here` is the layer root,
// because this file is where a standard Vite project keeps it. The built page
// lands beside the config (`web/dist`), and that is the directory name the
// Console serves from: the service's `distDir` is `<app root>/web/dist` too, so a
// source checkout and the built tree agree — `DIST_DIR_NAME` in
// `web/server/console-config.ts` and the literal below. Nothing links them at
// compile time, which is why `scripts/build.ts` copies this directory into the
// built tree's `web/dist` and the smoke run is what proves they agree (#84).
const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: here,
  // Relative asset URLs: the built index.html is served from `/` by the
  // Console's own http service, which appends its token to each emitted asset
  // URL (web/server/server.ts › sendPage).
  base: './',
  // The design system travels with the page layer it styles, so the plugin is
  // handed that layer's `uno.config.ts` by path. The path is explicit rather
  // than discovered: the plugin's first config load happens while its root is
  // still the process's working directory, and a discovery miss there logs a
  // "config not found" error before the root is corrected — noise on a build
  // that then succeeds. The page's entry imports `virtual:uno.css`, and that
  // virtual module only exists while this plugin is in the list.
  plugins: [
    vue(),
    UnoCSS({ configFile: fileURLToPath(new URL('uno.config.ts', import.meta.url)) }),
  ],
  build: { outDir: `${here}dist`, emptyOutDir: true },
  // `dev:web` only: the service must already be running on 8791, and GETs carry
  // no Origin, so the guard admits them without an extra allowed origin.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8791', changeOrigin: true } } },
})
