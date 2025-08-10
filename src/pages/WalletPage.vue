<script setup lang="ts">
  import newWalletView from 'src/components/newWallet.vue'
  import bchWalletView from 'src/components/bchWallet.vue'
  import myTokensView from 'src/components/myTokens.vue'
  import historyView from 'src/components/history/txHistory.vue'
  import settingsMenu from 'src/components/settingsMenu.vue'
  import connectDappView from 'src/components/connectDapp.vue'
  import createTokensView from 'src/components/createTokens.vue'
  import utxoManagement from 'src/components/utxoManagement.vue'
  import sweepPrivateKey from 'src/components/sweepPrivateKey.vue'
  import { ref, computed, watch } from 'vue'
  import { storeToRefs } from 'pinia'
  import { Wallet, TestNetWallet, DefaultProvider } from 'mainnet-js'
  import { waitForInitialized } from 'src/utils/utils'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  const store = useStore()
  const settingsStore = useSettingsStore()
  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)
  import { useQuasar } from 'quasar'
  const $q = useQuasar()

  const props = defineProps<{
    uri: string | undefined
  }>()

  const dappUriUrlParam = ref(undefined as undefined|string);
  const bchSendRequest = ref(undefined as undefined|string);
  const wifToSweep = ref(undefined as undefined|string);

  DefaultProvider.servers.chipnet = ["wss://chipnet.bch.ninja:50004"];

  // The currentView and its viewSpecificProps are computed based on 'store.displayView' 
  // These view & prop refs are passed to a dynamic component rendering the current view
  // This way views can be wrapped with KeepAlive to preserve its state across view changes
  // Excluding the settingsMenu bc we want to rerender it when navigating to it
  const currentView = computed(() => {
    if (!store._wallet) return newWalletView;

    switch (store.displayView) {
      case 1: return bchWalletView;
      case 2: return myTokensView;
      case 3: return historyView;
      case 4: return connectDappView;
      case 6: return createTokensView;
      case 7: return utxoManagement;
      case 8: return sweepPrivateKey;
      default: return null;
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
  
  // check if wallet exists
  const mainnetWalletExists = await Wallet.namedExists(store.nameWallet);
  const testnetWalletExists = await TestNetWallet.namedExists(store.nameWallet);
  const walletExists = mainnetWalletExists || testnetWalletExists;
  if(walletExists){
    // initialise wallet on configured network
    const readNetwork = localStorage.getItem('network');
    const walletClass = (readNetwork != 'chipnet')? Wallet : TestNetWallet;
    const initWallet = await walletClass.named(store.nameWallet);
    store.setWallet(initWallet);
  }
  
  // check if session request in URL params passed through props
  if(props?.uri?.startsWith('wc:') || props?.uri?.startsWith('cc:')){
    if(walletExists){
      dappUriUrlParam.value = props.uri
      // Promise will wait for state indicating whether WC and CC are initialized
      const { isWcAndCcInitialized } = storeToRefs(store);
      await waitForInitialized(isWcAndCcInitialized); 
      store.changeView(4);
    } else {
      $q.notify({
        message: "Need to initialize a wallet first",
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
        message: "Need to initialize a wallet first",
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
        message: "Need to initialize a wallet first",
        icon: 'warning',
        color: "grey-7"
      })
    }
  }

  watch(props, () => {
    if(!walletExists) return
    // check if session request in URL params passed through props
    if(props?.uri?.startsWith('wc:') || props?.uri?.startsWith('cc:')){
      dappUriUrlParam.value = props.uri
      store.changeView(4);
    }
    // check if BCH send request is passed through props
    if(props?.uri?.startsWith('bitcoincash:')){
      bchSendRequest.value = props.uri
      store.changeView(1);
    }
  })

  const hasUtxosWithBchAndTokens = computed(() => {
    if (!store.wallet || !store.walletUtxos) return undefined;
    return store.walletUtxos?.filter(utxo => utxo.token?.tokenId && utxo.satoshis > 100_000n).length > 0;
  });
  const newerReleaseAvailable = computed(() => {
    if(!(process.env.MODE == "electron")) return false;
    const applicationVersion = process.env.version
    return store.latestGithubRelease && store.latestGithubRelease !== 'v'+applicationVersion
  });
  const showNotificationIcon = computed(() => {
    if (!store.wallet || !store.walletUtxos) return undefined;
    return (!settingsStore.hasSeedBackedUp) || hasUtxosWithBchAndTokens.value || newerReleaseAvailable.value;
  });
</script>

<template>
  <header>
    <img :src="settingsStore.darkMode? 'images/cashonize-logo-dark.png' : 'images/cashonize-logo.png'" alt="Cashonize: a Bitcoin Cash Wallet" style="height: 85px;" >
    <nav v-if="store.displayView" style="display: flex; justify-content: center; user-select: none;" class="tabs">
      <div @click="store.changeView(1)" :class="{ active: store.displayView == 1 }"> {{ isMobile ? "Wallet" : "BchWallet" }} </div>
      <div @click="store.changeView(2)" :class="{ active: store.displayView == 2 }"> {{ isMobile ? "Tokens" : "MyTokens" }} </div>
      <div @click="store.changeView(3)" :class="{ active: store.displayView == 3 }"> {{ isMobile ? "History" : "TxHistory" }} </div>
      <div @click="store.changeView(4)" :class="{ active: store.displayView == 4 }"> {{ isMobile ? "Connect" : "WalletConnect" }} </div>
      <div @click="store.changeView(5)" style="width: max-content; position: relative;">
        <img style="vertical-align: text-bottom;" :src="store.displayView == 5 ? 'images/settingsGreen.svg' : (
          settingsStore.darkMode? 'images/settingsLightGrey.svg' : 'images/settings.svg')">
        <span v-if="showNotificationIcon" class="notification-dot"></span>
      </div>
    </nav>
  </header>
  <main style="margin: 20px auto; max-width: 78rem;">
    <KeepAlive v-if="store.displayView != 5">
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