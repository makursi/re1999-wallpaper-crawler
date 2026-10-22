<script setup lang="ts">
// ── The navigation pill ─────────────────────────────────────────────
//
// The floating glass navigation the page shell floats on (#48): the product
// name, the one number worth having at a glance, the way into the Run panel,
// the language switch, the version this build is (#79), and — when the boot's
// one check found a newer release — a single line linking to the Releases page
// (#81).
//
// #96 adds the page's one way out, quiet on the pill: idle it stops the program
// in one click, and a Run in flight makes the service refuse first, so the page
// asks here before anything is killed. The confirmation is the service's rule,
// surfaced — the page does not decide when to ask (ADR 0022).
//
// The blur filter appears exactly once, on this pill, which is fixed. It is
// never used on content that scrolls: a blurred scrolling surface is the one
// gesture the design system refuses.

import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
  DialogTrigger,
} from 'reka-ui'

import { useConsoleStatus } from '../composables/useConsoleStatus'
import { usePageExit } from '../composables/usePageExit'
import { t } from '../i18n/locale'
import Message from '../i18n/Message.vue'
import ConsoleUpdateNotice from './ConsoleUpdateNotice.vue'
import LocaleSwitch from './LocaleSwitch.vue'

// The nav's Mirror count and the drawer's Run facts are one fact, so they come
// from one store: `composables/useConsoleStatus.ts` holds the page's single read
// of `/api/status`, and the count above the wall follows the Run poll.
const { status } = useConsoleStatus()

// The exit is module-scoped too: one request in flight, one answered exit, one
// confirmation — the navigation renders it but does not own it.
const { exiting, awaitingConfirmation, refusalText, exit, confirm, cancel } = usePageExit()

/**
 * The dialog's own close (Esc, overlay, the cancel button) is a "no": nothing
 * is sent, and the program keeps running. The action button closes it too, but
 * `confirm()` has already sent the request by then, so this cannot undo it.
 */
function onConfirmOpen(open: boolean): void {
  if (!open) cancel()
}
</script>

<template>
  <!-- The floating glass pill. Fixed, so this is the one layer allowed a
       blur; not edge to edge, so it reads as something lying on the page.
       The entrance is the site's own register — two rem up, fading in, on
       the token's curve and duration — and it collapses under
       `prefers-reduced-motion` with every other duration. -->
  <div class="fixed inset-x-0 top-5 z-20 flex flex-col items-center gap-2 px-4">
    <header
      class="flex animate-rise-in flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-pill border border-border bg-glass px-4 py-2 backdrop-blur-md"
    >
      <h1 class="flex items-center gap-2 font-serif text-lg font-bold">
        <span class="i-ph-image-light text-xl" aria-hidden="true" />
        {{ t('app.title') }}
      </h1>

      <span class="h-5 w-px bg-border" aria-hidden="true" />

      <!-- The one number worth having at a glance: how much is in the Mirror.
           A data cell, so it takes the numeral role like every other count. -->
      <p class="numeric text-sm text-secondary">
        <Message
          v-if="status !== null"
          message="nav.mirrorCount"
          :params="{ count: status.mirrorCount }"
        />
        <template v-else>{{ t('app.readingMirror') }}</template>
      </p>

      <span class="h-5 w-px bg-border" aria-hidden="true" />

      <DialogTrigger as-child>
        <button
          type="button"
          class="flex cursor-pointer items-center gap-1 rounded-pill border border-transparent px-3 py-1 text-sm transition-colors duration-hover ease-standard hover:border-accent"
        >
          <!-- Navigation weight: the light Phosphor stroke, never the regular
               weight the dense data and the controls take. -->
          <span class="i-ph-sliders-horizontal-light" aria-hidden="true" />
          {{ t('nav.run') }}
        </button>
      </DialogTrigger>

      <LocaleSwitch />

      <!-- #96: the page's way out. Quiet, and last among the actions: idle it
           stops the program at once; a Run in flight is refused by the service,
           and the dialog below asks before anything is killed. -->
      <button
        type="button"
        class="flex cursor-pointer items-center gap-1 rounded-pill border border-transparent px-3 py-1 text-sm text-muted transition-colors duration-hover ease-standard hover:border-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="exiting"
        @click="exit"
      >
        <span class="i-ph-power-light" aria-hidden="true" />
        {{ t('nav.exit') }}
      </button>

      <!-- #81: the boot check found a newer release. One line, one link, and
           the line is the link: the reader fetches the zip from Releases
           themselves. Nothing is downloaded, replaced or asked. -->
      <template v-if="status?.updateNotice">
        <span class="h-5 w-px bg-border" aria-hidden="true" />
        <ConsoleUpdateNotice :notice="status.updateNotice" />
      </template>

      <span class="h-5 w-px bg-border" aria-hidden="true" />

      <!-- The number to quote when reporting a problem (#79): which build this
           page is. Quiet, because it is reference rather than status, but on
           the fixed pill so it is always in view; the value is a data cell. -->
      <p v-if="status?.version" class="text-xs text-muted">
        <Message message="nav.version" :params="{ version: status.version }" />
      </p>
    </header>

    <!-- A refused exit that is not the confirmation — the guard's 403, a
         transport failure — is one plain sentence under the pill (#83, #96).
         The confirmation itself is the dialog below, not this line. -->
    <p
      v-if="refusalText !== null"
      class="animate-rise-in rounded-pill border border-danger/40 bg-surface px-4 py-1 text-danger text-sm"
    >
      {{ refusalText }}
    </p>

    <!-- The confirmation (reka-ui's alert dialog, so Escape and the overlay are
         a "no" and focus is trapped). Shown only when the service answered
         `exit-confirm-required`; `confirm()` is the one request that carries
         `confirm: true`. -->
    <AlertDialogRoot :open="awaitingConfirmation" @update:open="onConfirmOpen">
      <AlertDialogPortal>
        <AlertDialogOverlay
          class="fixed inset-0 z-30 bg-scrim data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
        />
        <AlertDialogContent
          class="fixed top-1/2 left-1/2 z-30 flex w-[24rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-md border border-border bg-surface p-6 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
        >
          <AlertDialogTitle class="font-serif text-lg font-bold">
            {{ t('exit.confirmTitle') }}
          </AlertDialogTitle>
          <AlertDialogDescription class="text-secondary text-sm">
            {{ t('exit.confirmBody') }}
          </AlertDialogDescription>

          <div class="mt-2 flex justify-end gap-2">
            <AlertDialogCancel as-child>
              <button type="button" class="action-button text-sm" @click="cancel">
                {{ t('exit.cancelAction') }}
              </button>
            </AlertDialogCancel>
            <AlertDialogAction as-child>
              <button
                type="button"
                class="action-button text-sm"
                :disabled="exiting"
                @click="confirm"
              >
                {{ t('exit.confirmAction') }}
              </button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>
  </div>
</template>
