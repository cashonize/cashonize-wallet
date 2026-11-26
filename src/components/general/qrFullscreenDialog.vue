<script setup lang="ts">
  // A qr code enlarged for someone else's camera. On a phone it takes the whole screen and a tap
  // anywhere closes it; on wider screens it is a card whose code is sized with a slider.
  import { computed, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useWindowSize } from 'src/utils/composables'
  import QrCode from './qrCode.vue'

  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const showDialog = defineModel<boolean>({ required: true })

  defineProps<{
    contents: string
    label: string
    iconSrc: string
    /** What the code asks for, when it is more than an address */
    caption: string | undefined
    address: string
  }>()

  const { width, height } = useWindowSize()
  const isMobilePhone = computed(() => width.value < 480)

  // The slider's range ends where the card would no longer fit the window
  const minSize = 240
  const maxSize = computed(() => Math.max(minSize, Math.min(720, width.value - 100, height.value - 240)))
  const chosenSize = ref(400)
  const size = computed(() => Math.min(chosenSize.value, maxSize.value))
  const qrWidth = computed(() => isMobilePhone.value ? undefined : `${size.value}px`)
</script>

<template>
  <q-dialog v-model="showDialog" :maximized="isMobilePhone">
    <q-card class="qrFullscreen" :class="{ fullScreen: isMobilePhone }" v-close-popup="isMobilePhone">
      <q-btn class="closeButton" icon="close" :color="settingsStore.darkMode ? 'white' : 'black'" flat round dense v-close-popup />
      <!-- the white the code needs to stay scannable in dark mode -->
      <div class="qrTile" :style="{ width: qrWidth }" v-close-popup>
        <QrCode :contents="contents" :label="label">
          <img :src="iconSrc" alt="" />
        </QrCode>
      </div>
      <div v-if="caption" class="caption">{{ caption }}</div>
      <div class="address">{{ address }}</div>
      <div v-if="!isMobilePhone && maxSize > minSize" class="sizeRow">
        <q-icon name="qr_code_2" size="16px" />
        <q-slider :model-value="size" @update:model-value="(newSize) => { if (newSize !== null) chosenSize = newSize }" :min="minSize" :max="maxSize" :step="10" color="primary" :aria-label="t('qrCode.size')" />
        <q-icon name="qr_code_2" size="26px" />
      </div>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.qrFullscreen {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* past the width quasar caps a dialog at, the slider's range is what keeps it in the window */
  max-width: calc(100vw - 48px);
  padding: 48px 24px 20px;
}
.qrFullscreen.fullScreen {
  justify-content: center;
  max-width: none;
  padding: 0;
  cursor: pointer;
}
body.dark .qrFullscreen {
  background-color: var(--bg-color);
}
.closeButton {
  position: absolute;
  top: calc(8px + var(--safe-area-inset-top, 0px));
  right: 8px;
}
.qrTile {
  background-color: #fff;
  cursor: pointer;
  /* the svg is inline, which would leave a line's descent of white under the code */
  aspect-ratio: 1;
  overflow: hidden;
}
body.dark .qrTile {
  border-radius: 12px;
}
/* a square that fills the narrower side, leaving room below for the caption and the address */
.fullScreen .qrTile {
  width: min(100vw - 24px, 100dvh - 190px);
}
.caption {
  margin-top: 12px;
  font-size: 1.2em;
  text-align: center;
}
.address {
  margin-top: 12px;
  padding: 0 12px;
  /* the address wraps under the code rather than widening the card */
  width: 0;
  min-width: 100%;
  font-family: monospace;
  font-size: smaller;
  text-align: center;
  word-break: break-all;
  color: var(--color-grey);
}
.sizeRow {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 260px;
  margin-top: 16px;
  color: var(--color-grey);
}
</style>
