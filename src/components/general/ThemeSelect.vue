<script setup lang="ts">
  // The theme choice of the settings and of onboarding: the system's, light or dark, applied at once
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore, type ThemeMode } from 'src/stores/settingsStore'
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const themeModes = [
    { mode: 'system', icon: undefined, label: 'settings.userOptions.themeSystem' },
    { mode: 'light', icon: 'light_mode', label: 'settings.userOptions.themeLight' },
    { mode: 'dark', icon: 'dark_mode', label: 'settings.userOptions.themeDark' },
  ] as const

  function changeTheme(mode: ThemeMode) {
    // the colours fade over for this one change; left on, the transition would also run in the qr scanner
    document.body.classList.add('transition-enabled')
    setTimeout(() => document.body.classList.remove('transition-enabled'), 500)
    settingsStore.setThemeMode(mode)
  }
</script>

<template>
  <div class="type-filter theme-modes">
    <button v-for="theme in themeModes" :key="theme.mode" type="button" :class="{ active: settingsStore.themeMode === theme.mode }" @click="changeTheme(theme.mode)">
      <q-icon v-if="theme.icon" :name="theme.icon" size="18px" /> {{ t(theme.label) }}
    </button>
  </div>
</template>

<style scoped>
.theme-modes button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
}
</style>
