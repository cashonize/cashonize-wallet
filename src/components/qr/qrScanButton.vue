<script setup lang="ts">
  // The button that opens the scanner, beside every address input that takes one. Scanning is a
  // user option and the icon has a dark mode form, so both live here rather than at each input.
  import { useSettingsStore } from 'src/stores/settingsStore'

  const settingsStore = useSettingsStore()
</script>

<template>
  <button v-if="settingsStore.qrScan" style="padding: 12px">
    <img :src="settingsStore.darkMode ? 'images/qrscanLightGrey.svg' : 'images/qrscan.svg'" />
  </button>
</template>
