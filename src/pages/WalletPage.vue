<script setup lang="ts">
  import newWalletView from '../components/newWallet.vue'
  import bchWalletView from '../components/bchWallet.vue'
  import myTokensView from '../components/myTokens.vue'
  import settingsMenu from '../components/settingsMenu.vue'
  import connectView from '../components/walletConnect.vue'
  import createTokensView from '../components/createTokens.vue'
  import { ref, computed } from 'vue'
  import { Wallet, TestNetWallet, BalanceResponse, BCMR, binToHex } from 'mainnet-js'
  import type { CancelWatchFn } from 'mainnet-js';
  import { useStore } from '../stores/store'
  const store = useStore()

  const nameWallet = 'mywallet';
  const defaultBcmrIndexer = 'https://bcmr.paytaca.com/api';
  const defaultBcmrIndexerChipnet = 'https://bcmr-chipnet.paytaca.com/api';
  let cancelWatchBchtxs: undefined | CancelWatchFn;
  let cancelWatchTokenTxs: undefined | CancelWatchFn;

  const displayView = ref(undefined as (number | undefined));
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
</script>

<template>
  <header>
    <img :src="store.darkMode? '/images/cashonize-logo-dark.png' : '/images/cashonize-logo.png'" style="height: 85px;" >
    <nav v-if="displayView" style="display: flex; justify-content: center;">
      <div @click="changeView(1)" v-bind:style="displayView == 1 ? {color: 'var(--color-primary'} : ''">BchWallet</div>
      <div @click="changeView(2)" v-bind:style="displayView == 2 ? {color: 'var(--color-primary'} : ''">MyTokens</div>
      <div @click="changeView(3)" v-bind:style="displayView == 3 ? {color: 'var(--color-primary'} : ''">CreateTokens</div>
      <div @click="changeView(4)" v-bind:style="displayView == 4 ? {color: 'var(--color-primary'} : ''">WalletConnect</div>
      <div @click="changeView(5)">
        <img style="vertical-align: text-bottom;" v-bind:src="displayView == 5 ? 'images/settingsGreen.svg' : 
          store.darkMode? 'images/settingsLightGrey.svg' : 'images/settings.svg'">
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
</template>
../stores/store