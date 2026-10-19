<script setup lang="ts">
// ── A message with its data cells marked ────────────────────────────
//
// The dictionary carries whole sentences with `{name}` parameters
// (`web/src/i18n/messages.ts`), because a fragment before and a fragment after
// a value cannot express a language that puts the value somewhere else. That
// leaves one thing the template needs: the *value* is data — a count, a run id,
// a file name, a code — while the text around it is prose. This renders the
// message's pieces and gives every parameter the numeral role (`numeric`, the
// role ticket #49 landed: Geist with tabular figures), so a count inside a
// Chinese sentence still lines up and still uses the page's numeral face.
//
// A copy-only message does not need this component: `t()` in a template says it
// in one call. This one is the shape for a message that interpolates something.

import { computed } from 'vue'

import { tParts } from './locale'
import type { MessageKey, MessageParams } from './messages'

const props = defineProps<{
  /** The message key, English, as in the dictionary. */
  message: MessageKey
  /** The message's `{name}` values; each renders as a data cell. */
  params?: MessageParams
}>()

const parts = computed(() => tParts(props.message, props.params))
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <span v-if="part.name !== null" class="numeric">{{ part.text }}</span>
    <template v-else>{{ part.text }}</template>
  </template>
</template>
