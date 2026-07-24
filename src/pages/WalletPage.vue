<script setup lang="ts">
  import walletOnboardingView from 'src/components/walletOnboarding.vue'
  import addWalletView from 'src/components/settings/addWallet.vue'
  import bchWalletView from 'src/components/bchWallet.vue'
  import myTokensView from 'src/components/myTokens.vue'
  import historyView from 'src/components/history/txHistory.vue'
  import settingsMenu from 'src/components/settingsMenu.vue'
  import connectDappView from 'src/components/connectDapp.vue'
  import createTokensView from 'src/components/settings/createTokens.vue'
  import utxoManagement from 'src/components/settings/utxoManagement.vue'
  import sweepPrivateKey from 'src/components/settings/sweepPrivateKey.vue'
  import hdAddressesView from 'src/components/settings/hdAddresses.vue'
  import { defineComponent, ref, computed, watch } from 'vue'
  import { storeToRefs } from 'pinia'
  import { waitForInitialized } from 'src/utils/utils'
  import { namedWalletExistsInDb, getAllWalletsWithNetworkInfo } from 'src/utils/dbUtils'
  import { PROTOCOL_HANDLER as CASHCONNECT_PROTOCOL_HANDLER } from '@cashconnect-js/nostr'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  const store = useStore()
  const settingsStore = useSettingsStore()
  import { useWindowSize } from 'src/utils/composables'
  const { width } = useWindowSize();
  import { useQuasar } from 'quasar'
  const $q = useQuasar()
  import { useI18n } from 'vue-i18n'
  const { t } = useI18n()

  const props = defineProps<{
    uri: string | undefined
  }>()

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
  let walletHasMainnet = await namedWalletExistsInDb(walletToLoad, "bitcoincash");
  let walletHasChipnet = await namedWalletExistsInDb(walletToLoad, "bchtest");
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
    store.setWallet(initWallet);
    store.changeView(1);
    // fire-and-forget promise does not wait on full wallet initialization
    void store.initializeWallet();
    // Refresh the list of available wallets
    void store.refreshAvailableWallets();
  }
  // If no wallet exists, displayView stays undefined and onboarding is shown
  
  // check if session request in URL params passed through props
  if(props?.uri?.startsWith('wc:') || props?.uri?.startsWith(CASHCONNECT_PROTOCOL_HANDLER) || props?.uri?.toLowerCase().startsWith('wiz:')){
    if(walletExists){
      dappUriUrlParam.value = props.uri
      // Promise will wait for state indicating whether the dapp connection stores are initialized
      const { dappConnectionStoresInitialized } = storeToRefs(store);
      await waitForInitialized(dappConnectionStoresInitialized);
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
    if(props?.uri?.startsWith('wc:') || props?.uri?.startsWith(CASHCONNECT_PROTOCOL_HANDLER) || props?.uri?.toLowerCase().startsWith('wiz:')){
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
    return needsBackup || hasUtxosWithBchAndTokens.value || newerReleaseAvailable.value;
  });
</script>

<template>
  <header>
    <img :src="settingsStore.darkMode? 'images/cashonize-logo-dark.png' : 'images/cashonize-logo.png'" alt="Cashonize: a Bitcoin Cash Wallet" style="height: 85px;" >
    <nav v-if="store.displayView" style="display: flex; justify-content: center; user-select: none;" class="tabs">
      <div @click="store.changeView(1)" :class="{ active: store.displayView == 1 }"> {{ t('nav.wallet') }} </div>
      <div v-if="width > 450 && store.wallet.walletType === 'hd'" @click="store.changeView(10)" :class="{ active: store.displayView == 10 }"> {{ t('nav.addresses') }} </div>
      <div @click="store.changeView(2)" :class="{ active: store.displayView == 2 }"> {{ t('nav.tokens') }} </div>
      <div @click="store.changeView(3)" :class="{ active: store.displayView == 3 }"> {{ t('nav.history') }} </div>
      <div @click="store.changeView(4)" :class="{ active: store.displayView == 4 }"> {{ t('nav.connect') }} </div>
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
</template>

<style scoped>
.active {
  color: var(--color-primary);
}
</style>
