<script setup lang="ts">
  import { ref, watch } from 'vue'
  import { useAppLockStore } from 'src/stores/appLockStore'
  import AppLockScreen from 'src/components/appLockScreen.vue'
  const appLock = useAppLockStore()

  // A locked app does not load the wallet until its first unlock, so nothing signs or answers a
  // dApp behind the lock screen. A later lock only covers the app that is already running.
  const opened = ref(!appLock.locked)
  watch(() => appLock.locked, (locked) => { if (!locked) opened.value = true })

  // The time out of sight, after which coming back asks for the PIN again. The extension's pages
  // count it together instead (utils/bex/sharedUnlock.ts).
  if (!import.meta.env.QUASAR_BEX_MODE) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        appLock.awaySince = Date.now()
        return
      }
      appLock.lockIfAway()
      appLock.awaySince = undefined
    })
  }
</script>

<template>
  <suspense v-if="opened">
    <router-view />
  </suspense>
  <AppLockScreen v-if="appLock.locked" />
</template>
