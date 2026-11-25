<script setup lang="ts">
  // The theme choice of the settings and of onboarding: the system's, light, dim or dark, applied at once
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore, type ThemeMode } from 'src/stores/settingsStore'
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const themeModes = [
    { mode: 'system', icon: undefined, label: 'settings.userOptions.themeSystem' },
    { mode: 'light', icon: 'light_mode', label: 'settings.userOptions.themeLight' },
    { mode: 'dim', icon: 'brightness_medium', label: 'settings.userOptions.themeDim' },
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
/* four choices on one line: a phone has no room for their icons too, and a language with long
   words wraps */
.theme-modes {
  flex-wrap: wrap;
}
@media (max-width: 480px) {
  .theme-modes .q-icon {
    display: none;
  }
}
.theme-modes button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
}
</style>
