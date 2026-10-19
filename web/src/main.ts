// The three type roles' bytes, at build time. Each `@fontsource-variable`
// package carries the `@font-face` rules for its family and the woff2 files
// beside them, so importing the CSS is what puts both in the build: Vite emits
// every file those rules reference into `web/dist/assets`. No CDN, no runtime
// font request, and no font file in the repository — `web/dist` is git-ignored
// and the bytes live in `node_modules` (docs/adr/0015).
//
// These three imports come before the design system's stylesheet on purpose:
// the token preflight and the utilities are the page's own last word on what a
// role resolves to.
import '@fontsource-variable/geist'
import '@fontsource-variable/noto-serif-sc'
import '@fontsource-variable/playfair-display'
// The design system's stylesheet: UnoCSS generates it from web/uno.config.ts,
// and importing it here is what puts the reset, the token preflight and every
// atomic class the components name into the build.
import 'virtual:uno.css'
import { createApp } from 'vue'

import App from './App.vue'

createApp(App).mount('#app')
