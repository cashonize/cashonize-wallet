<script setup lang="ts">
  // What the app shows while locked: it lies over everything, dialogs and notifications included
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

  // Everything else on the page is made inert while the screen shows, a dialog opened meanwhile
  // included, so neither the keyboard nor a dialog's own focus trap reaches past it
  const madeInert = new Set<Element>()
  function makeOthersInert() {
    for (const element of document.body.children) {
      if (element === screen.value || element.hasAttribute('inert')) continue
      element.setAttribute('inert', '')
      madeInert.add(element)
    }
  }
  const observer = new MutationObserver(makeOthersInert)
  // keys typed with nothing focused stay here too, away from Quasar's Escape handling
  function keepKeys(event: KeyboardEvent) {
    if (event.target instanceof Node && screen.value?.contains(event.target)) return
    event.stopPropagation()
  }
  onMounted(() => {
    makeOthersInert()
    observer.observe(document.body, { childList: true })
    // only now, as an open dialog's focus trap took the focus back until it was made inert
    pinEntry.value?.focus()
    document.addEventListener('keydown', keepKeys, true)
  })
  onUnmounted(() => {
    observer.disconnect()
    for (const element of madeInert) element.removeAttribute('inert')
    document.removeEventListener('keydown', keepKeys, true)
  })
</script>

<template>
  <Teleport to="body">
  <div ref="screen" class="lock-screen" @click.self="pinEntry?.focus()">
    <img class="lock-logo" :src="settingsStore.darkMode ? 'images/cashonize-logo-dark.png' : 'images/cashonize-logo.png'" alt="Cashonize">
    <div class="lock-card">
      <span class="lock-badge"><q-icon name="lock" size="28px" /></span>
      <div class="lock-title">{{ t('appLock.lockedTitle') }}</div>
      <PinEntry ref="pinEntry" :check="appLock.unlock" :submit-label="t('appLock.unlockButton')" />
    </div>
    <div class="lock-forgot">
      <span class="action-link lock-forgot-link" @click="showForgot = !showForgot">{{ t('appLock.forgotPin') }}</span>
      <div v-if="showForgot" class="description">{{ t('appLock.forgotPinHint') }}</div>
    </div>
  </div>
  </Teleport>
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
  padding: 9vh 20px 20px;
  overflow-y: auto;
  background: var(--bg-color);
  color: var(--font-color);
}
.lock-logo {
  width: 200px;
  max-width: 60vw;
}
.lock-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 340px;
  margin-top: 36px;
  padding: 26px 20px 22px;
  border: 1px solid var(--surface-line);
  border-radius: 12px;
}
.lock-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-primary);
  color: #fff;
}
.lock-title {
  margin: 16px 0 10px;
  font-weight: 600;
  text-align: center;
}
.lock-forgot {
  max-width: 340px;
  margin-top: 8px;
  font-size: smaller;
  text-align: center;
}
/* a touch target of its own size, not of the text's */
.lock-forgot-link {
  display: inline-block;
  padding: 12px 16px;
}
.lock-forgot .description {
  margin-top: 0;
}
</style>
