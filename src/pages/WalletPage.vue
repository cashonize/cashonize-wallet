<script setup lang="ts">
  import newWalletView from 'src/components/newWallet.vue'
  import bchWalletView from 'src/components/bchWallet.vue'
  import myTokensView from 'src/components/myTokens.vue'
  import settingsMenu from 'src/components/settingsMenu.vue'
  import connectView from 'src/components/walletConnect.vue'
  import createTokensView from 'src/components/createTokens.vue'
  import WC2TransactionRequest from 'src/components/walletconnect/WC2TransactionRequest.vue';
  import WC2SignMessageRequest from 'src/components/walletconnect/WCSignMessageRequest.vue'
  import { ref, computed } from 'vue'
  import { Wallet, TestNetWallet } from 'mainnet-js'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useQuasar } from 'quasar'
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  // TODO: rework
  const props = defineProps<{
    uri: string | undefined
  }>()

  const transactionRequestWC = ref(undefined as any);
  const signMessageRequestWC = ref(undefined as any);
  // TODO: rework
  const dappMetadata = ref(undefined as any);
  const dappUriUrlParam = ref(undefined as undefined|string);
  
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

  function signedTransaction(broadcast: boolean){
    const message = broadcast ? 'Transaction succesfully sent!' : 'Transaction succesfully signed!'
    transactionRequestWC.value = undefined;
    $q.notify({
      type: 'positive',
      message
    })
  }
  function rejectTransaction(){
    transactionRequestWC.value = undefined;
  }
  function signMessage(){
    signMessageRequestWC.value = undefined;
    $q.notify({
      type: 'positive',
      message: 'Message succesfully signed!'
    })
  }
  function rejectSignMessage(){
    signMessageRequestWC.value = undefined;
  }
</script>

<template>
  <header>
    <img :src="settingsStore.darkMode? 'images/cashonize-logo-dark.png' : 'images/cashonize-logo.png'" alt="Cashonize: a Bitcoin Cash Wallet" style="height: 85px;" >
    <nav v-if="store.displayView" style="display: flex; justify-content: center;" class="tabs">
      <div @click="store.changeView(1)" v-bind:style="store.displayView == 1 ? {color: 'var(--color-primary'} : ''">BchWallet</div>
      <div @click="store.changeView(2)" v-bind:style="store.displayView == 2 ? {color: 'var(--color-primary'} : ''">MyTokens</div>
      <div v-if="!isMobile" @click="store.changeView(3)" v-bind:style="store.displayView == 3 ? {color: 'var(--color-primary'} : ''">CreateTokens</div>
      <div @click="store.changeView(4)" v-bind:style="store.displayView == 4 ? {color: 'var(--color-primary'} : ''">{{isMobile?  "Connect" : "WalletConnect"}}</div>
      <div @click="store.changeView(5)">
        <img style="vertical-align: text-bottom;" v-bind:src="store.displayView == 5 ? 'images/settingsGreen.svg' : 
          settingsStore.darkMode? 'images/settingsLightGrey.svg' : 'images/settings.svg'">
      </div>
    </nav>
  </header>
  <main style="margin: 20px auto; max-width: 78rem;">
    <newWalletView v-if="!store.wallet" @init-wallet="(arg) => store.setWallet(arg)"/>
    <bchWalletView v-if="store.displayView == 1"/>
    <myTokensView v-if="store.displayView == 2"/>
    <createTokensView v-if="store.displayView == 3"/>
    <connectView v-if="store.displayView == 4" :dappUriUrlParam="dappUriUrlParam"/>
    <settingsMenu v-if="store.displayView == 5"/>
  </main>
  <div v-if="transactionRequestWC">
    <WC2TransactionRequest :transactionRequestWC="transactionRequestWC" :dappMetadata="dappMetadata" @signed-transaction="(arg:boolean) => signedTransaction(arg)" @reject-transaction="rejectTransaction()"/>
  </div>
  <div v-if="signMessageRequestWC">
    <WC2SignMessageRequest :signMessageRequestWC="signMessageRequestWC" :dappMetadata="dappMetadata" @sign-message="() => signMessage()" @reject-sign-message="rejectSignMessage()"/>
  </div>
</template>
