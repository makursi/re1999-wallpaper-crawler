<script setup lang="ts">
import { computed } from 'vue'

import GalleryFigures from './components/GalleryFigures.vue'
import RunSetupNotice from './components/RunSetupNotice.vue'
import RunVerdict from './components/RunVerdict.vue'
import { useConsoleStatus } from './composables/useConsoleStatus'
import { useGallery } from './composables/useGallery'
import { useRunStart } from './composables/useRunStart'
import { t } from './i18n/locale'
import Message from './i18n/Message.vue'
import { galleryFiguresOf } from './lib/gallery-figures'
import { runProblemOf, runProgressOf } from './lib/run-panel'
import { startLabelKey } from './lib/run-start'
import OrphanPanel from './OrphanPanel.vue'

// The page's one status (`composables/useConsoleStatus.ts`): the panel shows the
// same snapshot the navigation's Mirror count is drawn from, and it no longer
// owns a poll of its own.
const { status, refresh } = useConsoleStatus()
// The page's one gallery read (`composables/useGallery.ts`), shared with the
// wall: the panel prints the same figures sentence above the same numbers (#94),
// so a panel saying 1013 beside a wall saying 1001 is impossible by construction.
const { gallery } = useGallery()
// The page's one start (`composables/useRunStart.ts`): the wall's band offers
// the same control on an empty wall, and the two must never both look ready.
const { starting, refusalText, start } = useRunStart()

/**
 * The figures line: `Gallery N · downloaded N · missing N`, or "Gallery unread".
 * The counts are `lib/gallery-figures.ts`'s and the sentence is the same
 * component the wall's header renders, which is what makes the two surfaces
 * agree about the numbers by construction rather than by review.
 */
const figures = computed(() => galleryFiguresOf(gallery.value))

/**
 * A Run in flight says "downloaded N of M" — the status's live Mirror count
 * against the Gallery total (#83) — and never a spinner. Both counts are live
 * contract facts, so the line moves as files land.
 */
const progress = computed(() =>
  runProgressOf(status.value?.mirrorCount ?? 0, status.value?.officialTotal ?? null),
)

/** The start control's word: first fetch, continue, or another try after a problem. */
const startWord = computed(() =>
  t(startLabelKey(status.value?.mirrorCount ?? 0, status.value?.verdict === 'defect')),
)

/**
 * The panel's at most-one problem line, chosen by `lib/run-panel.ts`'s priority
 * and rendered after the figures (#93's order). Keeping the rule out here is
 * what lets the panel decide where the line stands without moving the rule.
 */
const problem = computed(() => (status.value === null ? null : runProblemOf(status.value)))

// Closing the page stops nothing; the page's only stop is the navigation's Exit
// (ADR 0022), and the service makes it ask first while a Run is in flight. This
// panel owns no Run and adds no second stop. The first status read belongs to
// the store, and so does the poll it keeps while a Run is in flight.
</script>

<template>
  <!-- The panel is the drawer's content now (#48), so it owns no outer margin:
       the layer's own gap spaces it from the drawer's title. -->
  <section>
    <h2 class="font-serif text-[1.1rem] font-bold">{{ t('run.heading') }}</h2>

    <RunSetupNotice />

    <p v-if="status === null">{{ t('run.readingLog') }}</p>

    <template v-else>
      <!-- A Run in flight: the two counts, not a spinner (#83), and what the
           two stops mean. The page's only stop is the navigation's Exit
           (ADR 0022), which asks first; this panel adds no stop of its own. -->
      <template v-if="status.state === 'running'">
        <p class="font-serif">{{ t('wall.runningHeading') }}</p>
        <p><Message :message="progress.key" :params="progress.params" /></p>
        <p class="text-muted text-sm">{{ t('wall.runningHint') }}</p>
      </template>
      <!-- An Orphaned Run has its own component: it is the one state with an
           action, and the action is a POST the page must not get wrong. -->
      <OrphanPanel v-else-if="status.state === 'orphaned'" :status="status" @cleaned="refresh" />
      <p v-else-if="status.runId === null">{{ t('run.noLog') }}</p>
      <!-- The finished Run, in four lines: the verdict, the counts, the figures,
           and at most one problem line (#97). -->
      <template v-else>
        <RunVerdict />
        <p>
          <GalleryFigures :figures="figures" />
        </p>
        <!-- The panel's last line, after the figures (#93's order): one problem
             sentence, chosen by the priority in `lib/run-panel.ts`, and only
             when there is one. -->
        <p v-if="problem !== null" class="text-danger">
          <Message :message="problem.key" :params="problem.params" />
        </p>
      </template>
    </template>

    <p>
      <button
        type="button"
        class="action-button"
        :disabled="starting || status?.state === 'running'"
        @click="start"
      >
        <!-- An action control: the regular Phosphor weight, never the light
             weight reserved for large marks and navigation. -->
        <span class="i-ph-play mr-1" aria-hidden="true" />{{ startWord }}
      </button>
    </p>
    <p v-if="refusalText !== null" class="text-danger">{{ refusalText }}</p>
  </section>
</template>
