<script setup lang="ts">
// The full-size view (#35): one Wallpaper, served from the Mirror by
// `/api/image/<name>` — the original file, never a second derived size. The
// overlay is the only place the gallery's own id and the file name are shown
// together, so a page can be read against a Run report.
//
// Escape dismisses, the backdrop closes, and the button is focusable: the
// dialog opens from a tile and must be reachable from the keyboard alone.

import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  /** The gallery's own id; `null` for a Mirror file the list no longer holds. */
  id: number | null
  name: string
}>()

const emit = defineEmits<{ close: [] }>()

/** The token this page was opened with; the service wants it on every request. */
function consoleToken(): string {
  return new URLSearchParams(window.location.search).get('token') ?? ''
}

function imageUrl(): string {
  return `/api/image/${encodeURIComponent(props.name)}?token=${encodeURIComponent(consoleToken())}`
}

// A failed original (a file that vanished mid-view) is stated rather than
// turned into a broken image.
const failure = ref(false)

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="backdrop" role="presentation" @click.self="emit('close')">
    <figure role="dialog" aria-modal="true" :aria-label="name">
      <img :src="imageUrl()" :alt="name" @error="failure = true" />
      <figcaption>
        <span
          >Gallery id <strong>{{ id ?? '—' }}</strong></span
        >
        <code>{{ name }}</code>
        <button type="button" @click="emit('close')">Close (Esc)</button>
      </figcaption>
      <p v-if="failure">That file is no longer in the Mirror.</p>
    </figure>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: rgb(0 0 0 / 72%);
}

figure {
  display: flex;
  max-width: min(100%, 70rem);
  max-height: 100%;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
  padding: 0.75rem;
  border-radius: 0.4rem;
  background: #16181d;
}

img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
}

figcaption {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  color: #e6e8ec;
  font-family: system-ui, sans-serif;
  font-size: 0.9rem;
}

figcaption code {
  overflow: hidden;
  flex: 1;
  color: #9aa3b2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button {
  flex: none;
  padding: 0.3rem 0.6rem;
  border: 1px solid #414652;
  border-radius: 0.3rem;
  background: #23262e;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

p {
  margin: 0;
  color: #e6a5a5;
  font-family: system-ui, sans-serif;
  font-size: 0.9rem;
}
</style>
