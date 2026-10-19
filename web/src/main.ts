// The design system's stylesheet: UnoCSS generates it from web/uno.config.ts,
// and importing it here is what puts the reset, the token preflight and every
// atomic class the components name into the build.
import 'virtual:uno.css'
import { createApp } from 'vue'

import App from './App.vue'

createApp(App).mount('#app')
