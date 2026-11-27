<script setup lang="ts">
  import { ref, watch } from 'vue'
  import { useAppLockStore } from 'src/stores/appLockStore'
  import AppLockScreen from 'src/components/appLockScreen.vue'
  const appLock = useAppLockStore()

  // A locked app does not load the wallet until its first unlock, so nothing signs or answers a
  // dApp behind the lock screen. A later lock only covers the app that is already running.
  const opened = ref(!appLock.locked)
  watch(() => appLock.locked, (locked) => { if (!locked) opened.value = true })

  // time out of sight after which coming back asks for the PIN again
  const autoLockMs = 5 * 60_000
  let hiddenSince: number | undefined
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenSince = Date.now()
      return
    }
    if (hiddenSince !== undefined && Date.now() - hiddenSince >= autoLockMs) appLock.lock()
    hiddenSince = undefined
  })
</script>

<template>
  <suspense v-if="opened">
    <router-view />
  </suspense>
  <AppLockScreen v-if="appLock.locked" />
</template>
