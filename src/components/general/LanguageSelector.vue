<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore } from 'src/stores/settingsStore'

  const { locale } = useI18n()
  const settingsStore = useSettingsStore()

  const availableLocales = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' }
    // Add more languages here as they become available
    // { code: 'zh', name: '中文' },
  ]

  const selectedLocale = computed({
    get: () => locale.value,
    set: (value: string) => {
      locale.value = value
      settingsStore.locale = value
      localStorage.setItem('locale', value)
    }
  })
</script>

<template>
  <select v-model="selectedLocale" class="language-selector">
    <option v-for="loc in availableLocales" :key="loc.code" :value="loc.code">
      {{ loc.name }}
    </option>
  </select>
</template>

<style scoped>
.language-selector {
  padding: 4px 8px;
}
</style>
