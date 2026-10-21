<script setup lang="ts">
  // The button that opens the scanner, beside every address input that takes one. Scanning is a
  // user option, so it lives here rather than at each input.
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { iconQrScan } from 'src/utils/icons/svgIcons'

  const settingsStore = useSettingsStore()
</script>

<template>
  <button v-if="settingsStore.qrScan" style="padding: 12px">
    <q-icon class="app-icon qr-icon" :name="iconQrScan" size="16px" />
  </button>
</template>

<style scoped>
/* Beside a full width input the button gets squeezed, and the icon shrinks with it as the image
   it replaced did, rather than widening the button */
.qr-icon {
  width: 100%;
  max-width: 16px;
  height: auto;
  aspect-ratio: 1;
}
</style>
