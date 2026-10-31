<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { switchLocale } from 'src/boot/i18n'
  import { supportedLocales } from 'src/i18n'
  import { displayAndLogError } from 'src/utils/errorHandling'

  const { t, locale } = useI18n()
  const settingsStore = useSettingsStore()

  async function updateLocale(event: Event) {
    const select = event.target as HTMLSelectElement
    const value = select.value
    let applied: boolean
    try {
      applied = await switchLocale(value)
    } catch (error) {
      console.error(error)
      // the select already shows the pick, so put it back to the language still in use
      select.value = locale.value
      displayAndLogError(t('settings.localization.languageLoadFailed'))
      return
    }
    if (!applied) return
    settingsStore.locale = value
    localStorage.setItem('locale', value)
  }
</script>

<template>
  <select :value="locale" @change="updateLocale">
    <option v-for="loc in supportedLocales" :key="loc.code" :value="loc.code">
      {{ loc.name }}
    </option>
  </select>
</template>
