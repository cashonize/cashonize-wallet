<script setup lang="ts">
  import newWalletView from 'src/components/newWallet.vue'
  import bchWalletView from 'src/components/bchWallet.vue'
  import myTokensView from 'src/components/myTokens.vue'
  import settingsMenu from 'src/components/settingsMenu.vue'
  import connectDappView from 'src/components/connectDapp.vue'
  import createTokensView from 'src/components/createTokens.vue'
  import { ref, computed, watch } from 'vue'
  import { Wallet, TestNetWallet } from 'mainnet-js'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  const store = useStore()
  const settingsStore = useSettingsStore()
  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const props = defineProps<{
    uri: string | undefined
  }>()

  const dappUriUrlParam = ref(undefined as undefined|string);

  watch(props, () => {
    // check if session request in URL params passed through prop
    if(props?.uri?.startsWith('wc:') || props?.uri?.startsWith('cc:')){
      dappUriUrlParam.value = props.uri
      store.changeView(4);
    }
  })
  
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
  
  // check if session request in URL params passed through prop
  if(props?.uri?.startsWith('wc:') || props?.uri?.startsWith('cc:')){
    dappUriUrlParam.value = props.uri
    // workaround to solve race conditions with initialising stores
    await new Promise(resolve => setTimeout(resolve, 500)); 
    store.changeView(4);
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
    <connectDappView v-if="store.displayView == 4" :dappUriUrlParam="dappUriUrlParam"/>
    <settingsMenu v-if="store.displayView == 5"/>
  </main>
</template>
