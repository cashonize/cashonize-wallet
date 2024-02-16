<script setup lang="ts">
  import newWalletView from 'src/components/newWallet.vue'
  import bchWalletView from 'src/components/bchWallet.vue'
  import myTokensView from 'src/components/myTokens.vue'
  import settingsMenu from 'src/components/settingsMenu.vue'
  import connectView from 'src/components/walletConnect.vue'
  import createTokensView from 'src/components/createTokens.vue'
  import WC2TransactionRequest from 'src/components/walletconnect/WC2TransactionRequest.vue';
  import { ref, computed } from 'vue'
  import { Wallet, TestNetWallet, BalanceResponse, BCMR, binToHex } from 'mainnet-js'
  import type { CancelWatchFn } from 'mainnet-js';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const walletconnectStore = useWalletconnectStore()
  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const nameWallet = 'mywallet';
  const defaultBcmrIndexer = 'https://bcmr.paytaca.com/api';
  const defaultBcmrIndexerChipnet = 'https://bcmr-chipnet.paytaca.com/api';
  let cancelWatchBchtxs: undefined | CancelWatchFn;
  let cancelWatchTokenTxs: undefined | CancelWatchFn;

  const displayView = ref(undefined as (number | undefined));
  const transactionRequestWC = ref(undefined as any);
  const dappMetadata = ref(undefined as any);
  const bcmrIndexer = computed(() => store.network == 'mainnet' ? defaultBcmrIndexer : defaultBcmrIndexerChipnet)
  
  // check if wallet exists
  const mainnetWalletExists = await Wallet.namedExists(nameWallet);
  const testnetWalletExists = await TestNetWallet.namedExists(nameWallet);
  const walletExists = mainnetWalletExists || testnetWalletExists;
  if(walletExists){
    // initialise wallet on configured network
    const readNetwork = localStorage.getItem('network');
    const walletClass = (readNetwork != 'chipnet')? Wallet : TestNetWallet;
    const initWallet = await walletClass.named(nameWallet);
    setWallet(initWallet);
  }

  function changeView(newView: number){
    displayView.value = newView;
  }

  async function setWallet(newWallet: TestNetWallet){
    changeView(1);
    store.wallet = newWallet;
    console.time('initweb3wallet');
    await walletconnectStore.initweb3wallet();
    console.timeEnd('initweb3wallet');
    const web3wallet = walletconnectStore.web3wallet;
    web3wallet?.on('session_request', async (event: any) => {
      wcRequest(event);
    });
    console.time('Balance Promises');
    const promiseWalletBalance = store.wallet.getBalance() as BalanceResponse;
    const promiseMaxAmountToSend = store.wallet.getMaxAmountToSend();
    const promiseGetFungibleTokens = store.wallet.getAllTokenBalances();
    const promiseGetNFTs = store.wallet.getAllNftTokenBalances();
    const balancePromises: any[] = [promiseWalletBalance, promiseGetFungibleTokens, promiseGetNFTs,promiseMaxAmountToSend];
    const [resultWalletBalance, resultGetFungibleTokens, resultGetNFTs, resultMaxAmountToSend] = await Promise.all(balancePromises);
    console.timeEnd('Balance Promises');
    let tokenCategories = Object.keys({...resultGetFungibleTokens, ...resultGetNFTs});
    store.balance = resultWalletBalance;
    store.maxAmountToSend = resultMaxAmountToSend;
    const utxosPromise = store.wallet?.getAddressUtxos();
    await store.updateTokenList(resultGetFungibleTokens, resultGetNFTs);
    setUpWalletSubscriptions();
    // get plannedTokenId
    const walletUtxos = await utxosPromise;
    const preGenesisUtxo = walletUtxos?.find(utxo => !utxo.token && utxo.vout === 0);
    store.plannedTokenId = preGenesisUtxo?.txid ?? '';
    console.time('importRegistries');
    await importRegistries(tokenCategories);
    console.timeEnd('importRegistries');
    store.nrBcmrRegistries = BCMR.getRegistries().length ?? 0;
    await store.fetchAuthUtxos();
  }

  async function setUpWalletSubscriptions(){
    cancelWatchBchtxs = store.wallet?.watchBalance(async (newBalance) => {
      store.balance = newBalance;
      store.maxAmountToSend = await store.wallet?.getMaxAmountToSend();
    });
    cancelWatchTokenTxs = store.wallet?.watchAddressTokenTransactions(async(tx) => {
      if(!store.wallet) return // should never happen
      const walletPkh = binToHex(store.wallet.getPublicKeyHash() as Uint8Array);
      const tokenOutput = tx.vout.find(elem => elem.scriptPubKey.hex.includes(walletPkh));
      const tokenId = tokenOutput?.tokenData?.category;
      if(!tokenId) return;
      const previousTokenList = store.tokenList;
      const isNewCategory = !previousTokenList?.find(elem => elem.tokenId == tokenId);
      const promiseGetFungibleTokens = store.wallet.getAllTokenBalances();
      const promiseGetNFTs = store.wallet.getAllNftTokenBalances();
      const balancePromises: any[] = [promiseGetFungibleTokens, promiseGetNFTs];
      const [resultGetFungibleTokens, resultGetNFTs] = await Promise.all(balancePromises);
      // Dynamically import tokenmetadata
      if(isNewCategory){
        await importRegistries([tokenId]);
      }
      await store.updateTokenList(resultGetFungibleTokens, resultGetNFTs);
    });
  }

  async function changeNetwork(newNetwork: 'mainnet' | 'chipnet'){
    // cancel active listeners
    if(cancelWatchBchtxs && cancelWatchTokenTxs){
      cancelWatchBchtxs()
      cancelWatchTokenTxs()
    }
    const walletClass = (newNetwork == 'mainnet')? Wallet : TestNetWallet;
    const newWallet = await walletClass.named(nameWallet);
    setWallet(newWallet);
    localStorage.setItem('network', newNetwork);
    // reset wallet to default state
    store.balance = undefined;
    store.maxAmountToSend = undefined;
    store.plannedTokenId = undefined;
    store.tokenList = null;
    store.nrBcmrRegistries = undefined;
    changeView(1);
  }

  // Import onchain resolved BCMRs
  async function importRegistries(tokenIds: string[]) {
    let metadataPromises = [];
    for (const tokenId of tokenIds) {
      try {
        const metadataPromise = fetch(`${bcmrIndexer.value}/registries/${tokenId}/latest`);
        metadataPromises.push(metadataPromise);
      } catch (error) { /*console.log(error)*/ }
    }
    console.time('Promises BCMR indexer');
    const resolveMetadataPromsises = Promise.all(metadataPromises);
    const resultsMetadata = await resolveMetadataPromsises;
    console.timeEnd('Promises BCMR indexer');
    console.time('response.json()');
    for await (const response of resultsMetadata){
      if (response?.status != 404) {
        const jsonResponse = await response.json();
        BCMR.addMetadataRegistry(jsonResponse);
      }
    }
    console.timeEnd('response.json()');
  }

  // Wallet connect dialog functionality
  async function wcRequest(event: any) {
    const web3wallet = walletconnectStore.web3wallet;
    if(!web3wallet) return
    const { topic, params, id } = event;
    const { request } = params;
    const method = request.method;
    const walletAddress = store.wallet?.getDepositAddress();

    switch (method) {
      case "bch_getAddresses":
      case "bch_getAccounts": {
        const result = [walletAddress];
        const response = { id, jsonrpc: '2.0', result };
        web3wallet.respondSessionRequest({ topic, response });
      }
        break;
      case "bch_signMessage":
      case "personal_sign": {
        alert("bch_signMessage")
      }
        break;
      case "bch_signTransaction": {
        const sessions = web3wallet.getActiveSessions();
        const session = sessions[topic];
        if (!session) return;
        const metadataDapp = session.peer.metadata;
        dappMetadata.value = metadataDapp
        transactionRequestWC.value = event;
      }
        break;
      default:{
        const response = { id, jsonrpc: '2.0', error: {code: 1001, message: `Unsupported method ${method}`} };
        await web3wallet.respondSessionRequest({ topic, response });
      }
    }
  }
  // Reset transactionRequestWC after sign or reject
  function signedTransaction(txId:string){
    alert("Transaction succesfully sent! Txid:" + txId)
    transactionRequestWC.value = undefined;
  }
  function rejectTransaction(){
    transactionRequestWC.value = undefined;
  }
</script>

<template>
  <header>
    <img :src="settingsStore.darkMode? 'images/cashonize-logo-dark.png' : 'images/cashonize-logo.png'" style="height: 85px;" >
    <nav v-if="displayView" style="display: flex; justify-content: center;" class="tabs">
      <div @click="changeView(1)" v-bind:style="displayView == 1 ? {color: 'var(--color-primary'} : ''">{{isMobile?  "BCH" : "BchWallet"}}</div>
      <div @click="changeView(2)" v-bind:style="displayView == 2 ? {color: 'var(--color-primary'} : ''">{{isMobile?  "Tokens" : "myTokens"}}</div>
      <div @click="changeView(3)" v-bind:style="displayView == 3 ? {color: 'var(--color-primary'} : ''">{{isMobile?  "Create" : "CreateTokens"}}</div>
      <div @click="changeView(4)" v-bind:style="displayView == 4 ? {color: 'var(--color-primary'} : ''">{{isMobile?  "Connect" : "WalletConnect"}}</div>
      <div @click="changeView(5)">
        <img style="vertical-align: text-bottom;" v-bind:src="displayView == 5 ? 'images/settingsGreen.svg' : 
          settingsStore.darkMode? 'images/settingsLightGrey.svg' : 'images/settings.svg'">
      </div>
    </nav>
  </header>
  <main style="margin: 20px auto; max-width: 75rem;">
    <newWalletView v-if="!store.wallet" @init-wallet="(arg) => setWallet(arg)"/>
    <bchWalletView v-if="displayView == 1"/>
    <myTokensView v-if="displayView == 2"/>
    <createTokensView v-if="displayView == 3"/>
    <connectView v-if="displayView == 4"/>
    <settingsMenu v-if="displayView == 5" @change-network="(arg) => changeNetwork(arg)" @change-view="(arg) => changeView(arg)"/>
  </main>
  <div v-if="transactionRequestWC">
    <WC2TransactionRequest :transactionRequestWC="transactionRequestWC" :dappMetadata="dappMetadata" @signed-transaction="(arg:string) => signedTransaction(arg)" @reject-transaction="rejectTransaction()"/>
  </div>
</template>
