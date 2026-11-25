<script setup lang="ts">
  // What the app shows while locked: it lies over everything, dialogs and notifications included,
  // and keeps the keyboard to itself so nothing underneath can be reached by tabbing.
  import { onMounted, onUnmounted, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useAppLockStore } from 'src/stores/appLockStore'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import PinEntry from './general/PinEntry.vue'
  const appLock = useAppLockStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const screen = ref<HTMLElement>()
  const pinEntry = ref<InstanceType<typeof PinEntry>>()
  const showForgot = ref(false)

  function keepFocus(event: Event) {
    if (event.target instanceof Node && screen.value?.contains(event.target)) return
    event.stopPropagation()
    if (event instanceof KeyboardEvent) event.preventDefault()
    pinEntry.value?.focus()
  }
  onMounted(() => {
    document.addEventListener('focusin', keepFocus, true)
    document.addEventListener('keydown', keepFocus, true)
  })
  onUnmounted(() => {
    document.removeEventListener('focusin', keepFocus, true)
    document.removeEventListener('keydown', keepFocus, true)
  })
</script>

<template>
  <div ref="screen" class="lock-screen">
    <img class="lock-logo" :src="settingsStore.darkMode ? 'images/cashonize-logo-dark.png' : 'images/cashonize-logo.png'" alt="Cashonize">
    <div class="lock-title">{{ t('appLock.lockedTitle') }}</div>
    <PinEntry ref="pinEntry" :check="appLock.unlock" :submit-label="t('appLock.unlockButton')" />
    <div class="lock-forgot">
      <span class="action-link" @click="showForgot = !showForgot">{{ t('appLock.forgotPin') }}</span>
      <div v-if="showForgot" class="description">{{ t('appLock.forgotPinHint') }}</div>
    </div>
  </div>
</template>

<style scoped>
/* above Quasar's dialogs (6000) and notifications (9500) */
.lock-screen {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12vh 20px 20px;
  overflow-y: auto;
  background: var(--bg-color);
  color: var(--font-color);
}
.lock-logo {
  width: 240px;
  max-width: 70vw;
}
.lock-title {
  margin: 30px 0 16px;
  font-weight: 600;
}
.lock-forgot {
  max-width: 340px;
  margin-top: 28px;
  font-size: smaller;
  text-align: center;
}
.lock-forgot .description {
  margin-top: 8px;
}
</style>
