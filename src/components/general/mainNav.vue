<script setup lang="ts">
  // The app's tabs, one list drawn two ways: as text tabs under the logo, or as a bar of icons
  // fixed to the bottom of a phone screen. Which one is the page's call.
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import DappActivityButton from 'src/components/history/dappActivityButton.vue'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useIdentitiesStore } from 'src/stores/identitiesStore'
  import { menuSectionViewBase } from 'src/stores/constants'
  import { useWindowSize, addressesNavTabMinWidth } from 'src/utils/composables'

  defineProps<{ position: 'top' | 'bottom' }>()

  const store = useStore()
  const settingsStore = useSettingsStore()
  const identitiesStore = useIdentitiesStore()
  const { t, locale } = useI18n()
  const { width } = useWindowSize()

  // French, Portuguese and Russian tab labels are long enough to overflow small phone screens
  const compactNavTabs = computed(() => ['fr', 'pt', 'ru'].includes(locale.value))

  // Addresses is a tab only where there is room for it, which the bottom bar never has
  const showAddressesTab = computed(() => settingsStore.addressesInNav
    && width.value > addressesNavTabMinWidth
    && settingsStore.getWalletType(store.activeWalletName) === 'hd')

  const tabs = computed(() => {
    const view = store.displayView ?? 0
    return [
      // the wallet page and the two pages its actions open
      { id: 'wallet', view: 1, icon: 'sym_o_account_balance_wallet', active: [1, 17, 23].includes(view), shown: true },
      { id: 'addresses', view: 10, icon: 'view_list', active: view === 10, shown: showAddressesTab.value },
      { id: 'tokens', view: 2, icon: 'sym_o_toll', active: view === 2, shown: true },
      { id: 'history', view: 3, icon: 'sym_o_history', active: view === 3, shown: true },
      { id: 'connect', view: 4, icon: 'sym_o_link', active: view === 4, shown: true },
    ].filter(tab => tab.shown)
  })
  // the menu page and the pages under it
  const onMenuPage = computed(() => store.displayView === 5 || (store.displayView ?? 0) >= menuSectionViewBase)

  const hasUtxosWithBchAndTokens = computed(() => {
    if (!store._wallet || !store.walletUtxos) return undefined
    return store.walletUtxos?.filter(utxo => utxo.token?.category && utxo.satoshis > 100_000n).length > 0
  })
  const newerReleaseAvailable = computed(() => {
    if (!import.meta.env.QUASAR_ELECTRON_MODE) return false
    const applicationVersion = import.meta.env.version
    return store.latestGithubRelease && store.latestGithubRelease !== 'v' + applicationVersion
  })
  // what the menu has to say, marked on its tab
  const showNotificationIcon = computed(() => {
    if (!store._wallet || !store.walletUtxos) return undefined
    const needsBackup = settingsStore.getBackupStatus(store.activeWalletName) === 'none'
    return needsBackup || hasUtxosWithBchAndTokens.value || newerReleaseAvailable.value
      || identitiesStore.unseenIdentities.length > 0
  })

  // An on-screen keyboard that resizes the page would lift the bar over the form being filled in,
  // so the bar steps aside while a text field has focus
  const textFieldFocused = ref(false)
  function onFocusChange() {
    const element = document.activeElement
    textFieldFocused.value = element instanceof HTMLTextAreaElement
      || (element instanceof HTMLInputElement && !['checkbox', 'radio'].includes(element.type))
  }
  onMounted(() => {
    document.addEventListener('focusin', onFocusChange)
    document.addEventListener('focusout', onFocusChange)
  })
  onUnmounted(() => {
    document.removeEventListener('focusin', onFocusChange)
    document.removeEventListener('focusout', onFocusChange)
  })
</script>

<template>
  <nav v-if="position === 'top'" class="tabs" :class="{ compact: compactNavTabs }">
    <button v-for="tab in tabs" :key="tab.id" type="button" class="plain-button" :class="{ active: tab.active }" :aria-current="tab.active ? 'page' : undefined" @click="store.changeView(tab.view)">
      {{ t(`nav.${tab.id}`) }}
    </button>
    <div v-if="settingsStore.dappActivityInNav">
      <DappActivityButton icon-only />
    </div>
    <button type="button" class="menu-tab plain-button" :class="{ active: onMenuPage }" :aria-label="t('nav.menu')" :aria-current="onMenuPage ? 'page' : undefined" @click="store.changeView(5)">
      <q-icon name="more_horiz" size="22px" />
      <span v-if="showNotificationIcon" class="notification-dot" style="top: 8px; right: 6px;"></span>
    </button>
  </nav>
  <nav v-else v-show="!textFieldFocused" class="bottom-nav">
    <button v-for="tab in tabs" :key="tab.id" type="button" class="plain-button" :class="{ active: tab.active }" :aria-current="tab.active ? 'page' : undefined" @click="store.changeView(tab.view)">
      <q-icon :name="tab.icon" size="24px" :style="tab.id === 'connect' ? 'transform: rotate(-45deg);' : undefined" />
      <span>{{ t(`nav.${tab.id}`) }}</span>
    </button>
    <button type="button" class="plain-button" :class="{ active: onMenuPage }" :aria-current="onMenuPage ? 'page' : undefined" @click="store.changeView(5)">
      <span style="position: relative;">
        <q-icon name="more_horiz" size="24px" />
        <span v-if="showNotificationIcon" class="notification-dot" style="top: 0; right: -2px;"></span>
      </span>
      <span>{{ t('nav.menu') }}</span>
    </button>
  </nav>
</template>

<style scoped>
nav > button.active {
  color: var(--color-primary);
}

.tabs {
  display: flex;
  justify-content: center;
  user-select: none;
}
.tabs > * {
  padding: 1rem 2.5rem;
  cursor: pointer;
  border-bottom: 2px solid var(--color-lightGrey);
}
/* the tabs' underline carries the page structure, so it stays light in dark mode like the fieldsets */
:global(body.dark) .tabs > * {
  border-color: var(--color-strongOutline);
}
.tabs > .menu-tab {
  width: max-content;
  position: relative;
}
@media only screen and (max-width: 650px) {
  .tabs > * {
    padding: 1rem 1.8rem;
  }
}
@media only screen and (max-width: 600px) {
  .tabs > * {
    padding: 1rem;
  }
}
@media only screen and (max-width: 500px) {
  .tabs.compact > * {
    padding: 1rem 0.5rem;
  }
}

.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  /* Chrome's pattern for bottom bars: a fixed padding of the largest inset, moved down by what is
     not currently needed, so the bar never relayouts while scrolling */
  bottom: calc(env(safe-area-inset-bottom, 0px) - var(--safe-area-max-inset-bottom));
  z-index: 1000;
  display: flex;
  padding-bottom: var(--safe-area-max-inset-bottom);
  background-color: var(--bg-color);
  border-top: 1px solid var(--color-lightGrey);
  user-select: none;
}
.bottom-nav > button {
  flex: 1;
  min-width: 0;
  height: var(--bottom-nav-height);
  padding: 0 2px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 12px;
}
.bottom-nav > button > span:last-child {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-dot {
  position: absolute;
  width: 8px;
  height: 8px;
  background-color: var(--color-primary);
  border-radius: 50%;
}
/* two gentle pulse rings when the dot appears, then rest */
.notification-dot::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background-color: var(--color-primary);
  opacity: 0;
  animation: notification-pulse 1.6s ease-out 2;
}
@keyframes notification-pulse {
  0% {
    transform: scale(1);
    opacity: 0.6;
  }
  100% {
    transform: scale(3);
    opacity: 0;
  }
}
</style>
