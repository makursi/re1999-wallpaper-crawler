<script setup lang="ts">
import { locale, setLocale, t } from '../i18n/locale'
import { LOCALES } from '../i18n/messages'
</script>

<template>
  <div class="flex items-center gap-1" role="group" :aria-label="t('language.label')">
    <button
      v-for="option in LOCALES"
      :key="option"
      type="button"
      class="flex-none cursor-pointer rounded-pill border border-transparent px-3 py-1 text-sm transition-colors duration-hover ease-standard hover:border-accent"
      :class="option === locale ? 'border-accent text-primary' : 'text-muted'"
      :aria-pressed="option === locale"
      @click="setLocale(option)"
    >
      <!-- Each language names itself in its own language: a switch that
           says 中文 only in Chinese is useless to the reader who needs it. -->
      {{ t(option === 'zh-CN' ? 'language.chinese' : 'language.english') }}
    </button>
  </div>
</template>
