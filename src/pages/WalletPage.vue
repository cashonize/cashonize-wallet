<script setup lang="ts">
  import walletOnboardingView from 'src/components/walletOnboarding.vue'
  import addWalletView from 'src/components/settings/addWallet.vue'
  import bchWalletView from 'src/components/bchWallet.vue'
  import myTokensView from 'src/components/myTokens.vue'
  import historyView from 'src/components/history/txHistory.vue'
  import settingsMenu from 'src/components/settingsMenu.vue'
  import DappActivityButton from 'src/components/history/dappActivityButton.vue'
  import HeaderLogo from 'src/components/general/headerLogo.vue'
  import connectDappView from 'src/components/connectDapp.vue'
  import createTokensView from 'src/components/settings/createTokens.vue'
  import utxoManagement from 'src/components/settings/utxoManagement.vue'
  import sweepPrivateKey from 'src/components/settings/sweepPrivateKey.vue'
  import signVerifyMessageView from 'src/components/settings/signVerifyMessage.vue'
  import walletToolsView from 'src/components/settings/walletTools.vue'
  import exportXpubView from 'src/components/settings/exportXpub.vue'
  import transferAllAssetsView from 'src/components/settings/transferAllAssets.vue'
  import flipstarterView from 'src/components/settings/flipstarterPledge.vue'
  import identitiesView from 'src/components/settings/identitiesPage.vue'
  import requestPaymentView from 'src/components/settings/requestPayment.vue'
  import hdAddressesView from 'src/components/settings/hdAddresses.vue'
  import aboutCashonizeView from 'src/components/settings/aboutCashonize.vue'
  import portfolioView from 'src/components/portfolio/portfolioView.vue'
  import { defineComponent, ref, computed, watch, watchEffect, onMounted, onUnmounted } from 'vue'
  import { storeToRefs } from 'pinia'
  import { waitForInitialized } from 'src/utils/utils'
  import { preloadIcons } from 'src/utils/icons/preloadIcons'
  import { namedWalletExists } from '@cashonize/bch-wallet-lib'
  import { getAllWalletsWithNetworkInfo } from 'src/utils/wallet/dbUtils'
  import { walletDbName } from 'src/utils/wallet/networks'
  import { isDappConnectionUri } from 'src/utils/dapp/dappUri'
  import { useStore } from 'src/stores/store'
  import { useIdentitiesStore } from 'src/stores/identitiesStore'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { Dialog } from 'quasar'
  import IdentitiesFoundDialog from 'src/components/general/identitiesFoundDialog.vue'
  const store = useStore()
  const identitiesStore = useIdentitiesStore()
  const settingsStore = useSettingsStore()
  import { useWindowSize, addressesNavTabMinWidth } from 'src/utils/composables'
  const { width } = useWindowSize();
  import { useQuasar } from 'quasar'
  const $q = useQuasar()
  import { useI18n } from 'vue-i18n'
  const { t, locale } = useI18n()

  // French and Portuguese tab labels are long enough to overflow small phone screens
  const compactNavTabs = computed(() => ['fr', 'pt'].includes(locale.value))

  // Below the width where Addresses leaves the nav, so the bottom bar holds five tabs
  const navAtBottom = computed(() =>
    !!store.displayView && settingsStore.bottomNavOnMobile && width.value <= addressesNavTabMinWidth
  );
  // the notifies are mounted outside the page, they keep clear of the bar through the body class
  watchEffect(() => document.body.classList.toggle('bottom-nav', navAtBottom.value));

  // An on-screen keyboard that resizes the page would lift the bar over the form being filled in,
  // so the bar steps aside while a text field has focus
  const textFieldFocused = ref(false);
  function onFocusChange() {
    const element = document.activeElement;
    textFieldFocused.value = element instanceof HTMLTextAreaElement
      || (element instanceof HTMLInputElement && !['checkbox', 'radio'].includes(element.type));
  }
  onMounted(() => {
    document.addEventListener('focusin', onFocusChange);
    document.addEventListener('focusout', onFocusChange);
  });
  onUnmounted(() => {
    document.removeEventListener('focusin', onFocusChange);
    document.removeEventListener('focusout', onFocusChange);
  });

  const props = defineProps<{
    uri: string | undefined
  }>()

  // deliberately also runs during onboarding: creating a wallet switches to the wallet
  // view in the same session, so the preloaded icons are needed moments later
  onMounted(() => preloadIcons());

  const dappUriUrlParam = ref(undefined as undefined|string);
  const bchSendRequest = ref(undefined as undefined|string);
  const wifToSweep = ref(undefined as undefined|string);

  // The currentView and its viewSpecificProps are computed based on 'store.displayView'
  // and passed to a dynamic component wrapped in KeepAlive to preserve state.
  // KeepAlive stays mounted permanently so the views are cached regardless of navigation.
  // Settings View re-renders on navigation, a placeholder component used for the KeepAlive
  const emptyView = defineComponent({ render: () => null })
  const currentView = computed(() => {
    switch (store.displayView) {
      case 1: return bchWalletView;
      case 2: return myTokensView;
      case 3: return historyView;
      case 4: return connectDappView;
      case 5: return emptyView;
      case 6: return createTokensView;
      case 7: return utxoManagement;
      case 8: return sweepPrivateKey;
      case 9: return addWalletView;
      case 10: return hdAddressesView;
      case 11: return aboutCashonizeView;
      case 12: return portfolioView;
      case 13: return signVerifyMessageView;
      case 14: return walletToolsView;
      case 15: return exportXpubView;
      case 16: return transferAllAssetsView;
      case 17: return requestPaymentView;
      case 18: return flipstarterView;
      case 19: return identitiesView;
      default: return walletOnboardingView; // undefined or 0 shows onboarding
    }
  });

  const viewSpecificProps = computed(() => {
    if (!store._wallet) return {};

    switch (store.displayView) {
      case 1: return { bchSendRequest: bchSendRequest.value };
      case 4: return { dappUriUrlParam: dappUriUrlParam.value };
      case 8: return { wif: wifToSweep.value };
      default: return {};
    }
  });
  
  // check if named wallet already exists in indexedDB
  // we use a dbUtil and avoid 'WalletClass.namedExists' which instantiates a wallet + provider
  let walletToLoad = store.activeWalletName;
  let walletHasMainnet = await namedWalletExists(walletToLoad, walletDbName('mainnet'));
  let walletHasChipnet = await namedWalletExists(walletToLoad, walletDbName('chipnet'));
  let walletExists = walletHasMainnet || walletHasChipnet;

  // If active wallet doesn't exist somehow, try to fall back to any existing wallet
  if (!walletExists) {
    const allWallets = await getAllWalletsWithNetworkInfo();
    const fallbackWallet = allWallets[0];
    if (fallbackWallet) {
      walletToLoad = fallbackWallet.name;
      walletHasMainnet = fallbackWallet.hasMainnet;
      walletHasChipnet = fallbackWallet.hasChipnet;
      walletExists = true;
      // Update stored active wallet name
      store.activeWalletName = walletToLoad;
      localStorage.setItem('activeWalletName', walletToLoad);
    }
  }

  if(walletExists){
    // initialise wallet on configured network
    let readNetwork = (localStorage.getItem('network') ?? 'mainnet') as 'mainnet' | 'chipnet';
    // if the wallet only exists on the other network (legacy single-network wallet or
    // fallback wallet), correct the configured network instead of loading a missing wallet
    const walletExistsOnNetwork = readNetwork === 'mainnet' ? walletHasMainnet : walletHasChipnet;
    if (!walletExistsOnNetwork) {
      readNetwork = walletHasMainnet ? 'mainnet' : 'chipnet';
      localStorage.setItem('network', readNetwork);
    }
    const initWallet = await store.loadExistingWallet(walletToLoad, readNetwork);
    await store.setWallet(initWallet);
    store.changeView(1);
    // fire-and-forget promise does not wait on full wallet initialization
    void store.initializeWallet();
    // Refresh the list of available wallets
    void store.refreshAvailableWallets();
  }
  // If no wallet exists, displayView stays undefined and onboarding is shown
  
  // check if session request in URL params passed through props
  if(props?.uri && isDappConnectionUri(props.uri)){
    if(walletExists){
      dappUriUrlParam.value = props.uri
      // Wait for the dapp connection stores to finish their init attempt (success or failure)
      // before switching to the connect view, so pairing there can proceed or error naturally
      const { dappConnectionStoresInitDone } = storeToRefs(store);
      await waitForInitialized(dappConnectionStoresInitDone);
      store.changeView(4);
    } else {
      $q.notify({
        message: t('common.errors.needToInitializeWallet'),
        icon: 'warning',
        color: "grey-7"
      })
    }
  }
  // check if BCH send request is passed through props
  if(props?.uri?.startsWith('bitcoincash:')){
    if(walletExists){
      bchSendRequest.value = props.uri
      store.changeView(1);
    } else {
      $q.notify({
        message: t('common.errors.needToInitializeWallet'),
        icon: 'warning',
        color: "grey-7"
      })
    }
  }
  // check if sweep request is passed through props
  if(props?.uri?.startsWith('bch-wif:')){
    if(walletExists){
      wifToSweep.value = props.uri
      store.changeView(8);
    } else {
      $q.notify({
        message: t('common.errors.needToInitializeWallet'),
        icon: 'warning',
        color: "grey-7"
      })
    }
  }

  watch(props, () => {
    // check live wallet state, not the setup-time walletExists: a wallet may have been created via onboarding since
    if(!store._wallet) return
    // check if session request in URL params passed through props
    if(props?.uri && isDappConnectionUri(props.uri)){
      dappUriUrlParam.value = props.uri
      store.changeView(4);
    }
    // check if BCH send request is passed through props
    if(props?.uri?.startsWith('bitcoincash:')){
      bchSendRequest.value = props.uri
      store.changeView(1);
    }
    // check if sweep request is passed through props
    if(props?.uri?.startsWith('bch-wif:')){
      wifToSweep.value = props.uri
      store.changeView(8);
    }
  })

  const hasUtxosWithBchAndTokens = computed(() => {
    if (!store._wallet || !store.walletUtxos) return undefined;
    return store.walletUtxos?.filter(utxo => utxo.token?.category && utxo.satoshis > 100_000n).length > 0;
  });
  const newerReleaseAvailable = computed(() => {
    if(!import.meta.env.QUASAR_ELECTRON_MODE) return false;
    const applicationVersion = import.meta.env.version
    return store.latestGithubRelease && store.latestGithubRelease !== 'v'+applicationVersion
  });
  const showNotificationIcon = computed(() => {
    if (!store._wallet || !store.walletUtxos) return undefined;
    const needsBackup = settingsStore.getBackupStatus(store.activeWalletName) === 'none';
    return needsBackup || hasUtxosWithBchAndTokens.value || newerReleaseAvailable.value
      || identitiesStore.unseenIdentities.length > 0;
  });

  // The store says what to announce; the dialog is opened here and the request cleared. The
  // passes at open announce one after another, so the dialog waits a moment and says them all.
  let announcementTimer: ReturnType<typeof setTimeout> | undefined;
  watch(() => identitiesStore.announcement, (pending) => {
    if (!pending || announcementTimer) return;
    announcementTimer = setTimeout(() => {
      announcementTimer = undefined;
      const taken = identitiesStore.takeAnnouncement();
      if (!taken?.ids.length) return;
      Dialog.create({ component: IdentitiesFoundDialog, componentProps: { ids: taken.ids, sources: taken.sources } })
        .onOk((payload: { learn: boolean }) => {
          if (payload.learn) identitiesStore.requestLearn();
          store.changeView(19);
        });
    }, 500);
  });
</script>

<template>
  <header>
    <HeaderLogo />
    <div v-if="navAtBottom && settingsStore.dappActivityInNav" class="header-dapp-activity">
      <DappActivityButton icon-only />
    </div>
    <nav v-if="store.displayView && !navAtBottom" style="display: flex; justify-content: center; user-select: none;" class="tabs" :class="{ compact: compactNavTabs }">
      <div @click="store.changeView(1)" :class="{ active: store.displayView == 1 }"> {{ t('nav.wallet') }} </div>
      <div v-if="width > addressesNavTabMinWidth && settingsStore.getWalletType(store.activeWalletName) === 'hd'" @click="store.changeView(10)" :class="{ active: store.displayView == 10 }"> {{ t('nav.addresses') }} </div>
      <div @click="store.changeView(2)" :class="{ active: store.displayView == 2 }"> {{ t('nav.tokens') }} </div>
      <div @click="store.changeView(3)" :class="{ active: store.displayView == 3 }"> {{ t('nav.history') }} </div>
      <div @click="store.changeView(4)" :class="{ active: store.displayView == 4 }"> {{ t('nav.connect') }} </div>
      <div v-if="settingsStore.dappActivityInNav" class="nav-dapp-activity">
        <DappActivityButton icon-only />
      </div>
      <div @click="store.changeView(5)" style="width: max-content; position: relative;">
        <img style="vertical-align: text-bottom;" :src="store.displayView == 5 ? 'images/settingsGreen.svg' : (
          settingsStore.darkMode? 'images/settingsLightGrey.svg' : 'images/settings.svg')">
        <span v-if="showNotificationIcon" class="notification-dot"></span>
      </div>
    </nav>
  </header>
  <main style="margin: 20px auto; max-width: 78rem;">
    <KeepAlive>
      <component :is="currentView" v-bind="viewSpecificProps"/>
    </KeepAlive>
    <settingsMenu v-if="store.displayView == 5" />
  </main>
  <nav v-if="navAtBottom" v-show="!textFieldFocused" class="bottom-nav">
    <div @click="store.changeView(1)" :class="{ active: store.displayView == 1 }">
      <q-icon name="sym_o_account_balance_wallet" size="24px" />
      <span>{{ t('nav.wallet') }}</span>
    </div>
    <div @click="store.changeView(2)" :class="{ active: store.displayView == 2 }">
      <q-icon name="sym_o_toll" size="24px" />
      <span>{{ t('nav.tokens') }}</span>
    </div>
    <div @click="store.changeView(3)" :class="{ active: store.displayView == 3 }">
      <q-icon name="sym_o_history" size="24px" />
      <span>{{ t('nav.history') }}</span>
    </div>
    <div @click="store.changeView(4)" :class="{ active: store.displayView == 4 }">
      <q-icon name="sym_o_link" size="24px" style="transform: rotate(-45deg);" />
      <span>{{ t('nav.connect') }}</span>
    </div>
    <div @click="store.changeView(5)" :class="{ active: store.displayView == 5 }">
      <span style="position: relative;">
        <q-icon name="ion_settings_outline" size="24px" style="transform: scale(0.875);" />
        <span v-if="showNotificationIcon" class="notification-dot" style="top: 0; right: -2px;"></span>
      </span>
      <span>{{ t('settings.title') }}</span>
    </div>
  </nav>
</template>

<style scoped>
.active {
  color: var(--color-primary);
}
header {
  position: relative;
}
/* the header keeps the dApp activity icon when the tabs move to the bottom */
.header-dapp-activity {
  position: absolute;
  top: calc(15px + var(--safe-area-inset-top, 0px));
  right: 12px;
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
.bottom-nav > div {
  flex: 1;
  min-width: 0;
  height: var(--bottom-nav-height);
  padding: 0 2px;
  border: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 12px;
}
.bottom-nav > div > span:last-child {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
