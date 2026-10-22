<script setup lang="ts">
// ── The wall's band: empty, fetching, interrupted, or resuming (#83) ─
//
// An empty wall must not look broken. This is the band above the tiles that
// says what the wall is waiting for, how big the first fetch is, and — the one
// action that matters — the control that starts it. During a Run the same band
// turns into the progress line; an interrupted Run says where its cleanup is;
// and on a wall that already holds some Wallpapers it says another start
// continues rather than restarts.
//
// Which of them is showing is `lib/wall-state.ts`'s answer, not this
// template's; the copy is the dictionary's, in the reader's language; and the
// start itself is `composables/useRunStart.ts`'s one action, shared with the
// drawer so the two buttons can never disagree about a start being in flight.
//
// "How many are left" is the Mirror gap's missing count (#94) — the same number
// the header prints — and the downloaded count beside it is `facts.downloaded`,
// the figures' complement over the Gallery total, so the resume band and the
// header cannot disagree. Only the running band's progress reads the status's
// live Mirror count: it moves while a Run writes, and it is progress, not the
// header.

import { computed } from 'vue'

import { useRunStart } from '../composables/useRunStart'
import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'
import { startLabelKey } from '../lib/run-start'
import type { WallBand, WallFacts } from '../lib/wall-state'

const props = defineProps<{
  /** What the wall is saying: the empty invitation, progress, a resume, or nothing. */
  band: WallBand
  /** What the wall draws, what the gap says, and the live counts of a Run. */
  facts: WallFacts
  /** Whether the newest Run reported a problem, which changes the button's word. */
  lastRunFailed: boolean
}>()

const { starting, refusalText, start } = useRunStart()

/** The one control's word: the first fetch, a resume, or another try. */
const actionLabel = computed(() =>
  t(startLabelKey(props.facts.wallpaperCount, props.lastRunFailed)),
)

/** The progress sentence, and whether the list is there to divide by. */
const progressKey = computed(() =>
  props.facts.officialTotal === null ? 'wall.progressUnknownTotal' : 'wall.progress',
)

/**
 * The progress of a Run in flight: the status's live Mirror count, which moves
 * as files land. It is deliberately not the header's `downloaded` — a Run in
 * flight has not been re-read into rows yet, and this line exists to move.
 */
const liveProgressParams = computed(() => ({
  done: props.facts.liveMirrorCount,
  total: props.facts.officialTotal ?? 0,
}))

/**
 * The progress of a wall that is not being fetched right now: official entries
 * on disk of the list's total, so it agrees with the figures line above. An
 * unread list falls back to the tiles it actually draws, in the unknown-total
 * sentence.
 */
const downloadedProgressParams = computed(() => ({
  done: props.facts.downloaded ?? props.facts.wallpaperCount,
  total: props.facts.officialTotal ?? 0,
}))
</script>

<template>
  <!-- The empty wall: the invitation, the honest size of the first fetch, and
       the one control. Nothing here runs on mount — the only start is a click. -->
  <section
    v-if="band === 'empty'"
    class="mb-12 flex animate-rise-in flex-col items-start gap-4 border border-border bg-surface-raised p-8"
  >
    <h3 class="font-serif text-3xl leading-tight">{{ t('wall.emptyHeading') }}</h3>
    <p class="max-w-[52rem] text-secondary">{{ t('wall.emptyBody') }}</p>
    <!-- Numbers, not adjectives: about 1000+, about 2 GB, 10–40 minutes. -->
    <p class="max-w-[52rem] text-sm text-muted">{{ t('wall.emptyScale') }}</p>
    <button
      type="button"
      class="action-button border-accent px-6 py-3 text-accent text-base"
      :disabled="starting"
      @click="start"
    >
      <span class="i-ph-download-simple mr-2" aria-hidden="true" />{{ actionLabel }}
    </button>
    <p v-if="refusalText !== null" class="text-danger">{{ refusalText }}</p>
    <p class="max-w-[52rem] text-muted text-sm">{{ t('wall.emptyResumeHint') }}</p>
  </section>

  <!-- A Run in flight: two counts that move, and what the two stops mean. The
       page's only stop is the navigation's Exit (ADR 0022), which asks first;
       closing the window is the other, and this band adds no stop of its own. -->
  <section
    v-else-if="band === 'running'"
    class="mb-10 flex flex-col gap-2 border border-border bg-surface-raised p-6"
    aria-live="polite"
  >
    <p class="font-serif text-2xl">{{ t('wall.runningHeading') }}</p>
    <p class="text-primary text-lg">
      <Message :message="progressKey" :params="liveProgressParams" />
    </p>
    <p class="text-muted text-sm">{{ t('wall.runningHint') }}</p>
  </section>

  <!-- An interrupted Run: a start is refused until the leftover is cleaned up,
       so the band names that and says where the cleanup is, rather than offering
       a control that cannot work. -->
  <section
    v-else-if="band === 'orphaned'"
    class="mb-10 flex flex-col gap-2 border border-border bg-surface-raised p-6"
  >
    <p class="font-serif text-2xl">{{ t('wall.interruptedHeading') }}</p>
    <p class="text-primary">
      <Message :message="progressKey" :params="downloadedProgressParams" />
    </p>
    <p class="max-w-[52rem] text-muted text-sm">{{ t('wall.interruptedBody') }}</p>
  </section>

  <!-- Some wall, some list: another start continues. -->
  <section
    v-else-if="band === 'resume'"
    class="mb-10 flex flex-col items-start gap-3 border border-border bg-surface-raised p-6"
  >
    <p class="font-serif text-2xl">
      <Message message="wall.progress" :params="downloadedProgressParams" />
    </p>
    <p v-if="facts.missing !== null" class="max-w-[52rem] text-muted text-sm">
      <Message message="wall.resumeBody" :params="{ remaining: facts.missing }" />
    </p>
    <!-- The band's rule cannot reach here with an unread list, but the copy
         never invents a number on a fact that is absent. -->
    <p v-else class="max-w-[52rem] text-muted text-sm">{{ t('wall.emptyResumeHint') }}</p>
    <button
      type="button"
      class="action-button px-5 py-2 text-accent"
      :disabled="starting"
      @click="start"
    >
      <span class="i-ph-play mr-2" aria-hidden="true" />{{ actionLabel }}
    </button>
    <p v-if="refusalText !== null" class="text-danger">{{ refusalText }}</p>
  </section>
</template>
