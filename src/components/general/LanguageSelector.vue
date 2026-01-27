<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore } from 'src/stores/settingsStore'

  const { locale } = useI18n()
  const settingsStore = useSettingsStore()

  const availableLocales = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' }
  ]

  function updateLocale(value: string) {
    locale.value = value
    settingsStore.locale = value
    localStorage.setItem('locale', value)
  }
</script>

<template>
  <select :value="locale" @change="updateLocale(($event.target as HTMLSelectElement).value)">
    <option v-for="loc in availableLocales" :key="loc.code" :value="loc.code">
      {{ loc.name }}
    </option>
  </select>
</template>
