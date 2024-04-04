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
  import type { Web3WalletTypes } from '@walletconnect/web3wallet';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const walletconnectStore = useWalletconnectStore()
  import { useWindowSize } from '@vueuse/core'
import { TokenList } from 'src/interfaces/interfaces'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const props = defineProps<{
    uri: string
  }>()

  const nameWallet = 'mywallet';
  const defaultBcmrIndexer = 'https://bcmr.paytaca.com/api';
  const defaultBcmrIndexerChipnet = 'https://bcmr-chipnet.paytaca.com/api';
  let cancelWatchBchtxs: undefined | CancelWatchFn;
  let cancelWatchTokenTxs: undefined | CancelWatchFn;

  const displayView = ref(undefined as (number | undefined));
  const transactionRequestWC = ref(undefined as any);
  const dappMetadata = ref(undefined as any);
  const dappUriUrlParam = ref(undefined as undefined|string);
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
    web3wallet?.on('session_request', async (event) => wcRequest(event));
    // check if session request in URL params
    if(props?.uri?.startsWith('wc:')){
      dappUriUrlParam.value = props.uri
      changeView(4);
    }
    // fetch bch balance
    console.time('Balance Promises');
    const promiseWalletBalance = store.wallet.getBalance() as BalanceResponse;
    const promiseMaxAmountToSend = store.wallet.getMaxAmountToSend();
    const balancePromises = [promiseWalletBalance,promiseMaxAmountToSend];
    const [resultWalletBalance, resultMaxAmountToSend] = await Promise.all(balancePromises);
    console.timeEnd('Balance Promises');
    // fetch token balance
    console.time('fetch tokenUtxos Promise');
    await store.updateTokenList();
    console.timeEnd('fetch tokenUtxos Promise');
    store.balance = resultWalletBalance;
    store.maxAmountToSend = resultMaxAmountToSend;
    const utxosPromise = store.wallet?.getAddressUtxos();
    setUpWalletSubscriptions();
    // get plannedTokenId
    const walletUtxos = await utxosPromise;
    const preGenesisUtxo = walletUtxos?.find(utxo => !utxo.token && utxo.vout === 0);
    store.plannedTokenId = preGenesisUtxo?.txid ?? '';
    if(!store.tokenList) return // should never happen
    console.time('importRegistries');
    await importRegistries(store.tokenList);
    console.timeEnd('importRegistries');
    console.time('fetchAuthUtxos');
    await store.fetchAuthUtxos();
    console.timeEnd('fetchAuthUtxos');
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
      await store.updateTokenList();
      // Dynamically import tokenmetadata
      if(isNewCategory) await importRegistries([tokenId]);
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
    store.bcmrRegistries = undefined;
    changeView(1);
  }

  // Import onchain resolved BCMRs
  async function importRegistries(tokenList: TokenList) { 
    let metadataPromises = [];
    for (const item of tokenList){
      if('nfts' in item){
        for (const nft of item.nfts.slice(0,1)){
          const metadataPromise = fetch(`${bcmrIndexer.value}/tokens/${item.tokenId}/${nft.token?.commitment}`);
          metadataPromises.push(metadataPromise);
        }
      } else{
        const metadataPromise = fetch(`${bcmrIndexer.value}/tokens/${item.tokenId}`);
        metadataPromises.push(metadataPromise);
      }
    }

      console.time('Promises BCMR indexer');
      const resolveMetadataPromsises = Promise.all(metadataPromises);
      const resultsMetadata = await resolveMetadataPromsises;
      console.timeEnd('Promises BCMR indexer');
      console.time('response.json()');
      const registries: any = {}
      for await (const response of resultsMetadata){
        if (response?.status != 404) {
          const jsonResponse = await response.json();
          const tokenId = jsonResponse?.token?.category
          if(jsonResponse?.type_metadata){
            const commitment = response.url.split("/").at(-2) as string;
            if(!registries[tokenId]) registries[tokenId] = jsonResponse;
            if(!registries[tokenId]?.nfts) registries[tokenId].nfts = {}
            registries[tokenId].nfts[commitment] = jsonResponse?.type_metadata
          } else {
            registries[tokenId] = jsonResponse;
          }
        }
      }
      console.timeEnd('response.json()');
      console.log(registries)
      store.bcmrRegistries = registries
      console.log(registries)
  }

  // Wallet connect dialog functionality
  async function wcRequest(event: Web3WalletTypes.SessionRequest) {
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
    <img :src="settingsStore.darkMode? 'images/cashonize-logo-dark.png' : 'images/cashonize-logo.png'" alt="Cashonize: a Bitcoin Cash Wallet" style="height: 85px;" >
    <nav v-if="displayView" style="display: flex; justify-content: center;" class="tabs">
      <div @click="changeView(1)" v-bind:style="displayView == 1 ? {color: 'var(--color-primary'} : ''">BchWallet</div>
      <div @click="changeView(2)" v-bind:style="displayView == 2 ? {color: 'var(--color-primary'} : ''">MyTokens</div>
      <div v-if="!isMobile" @click="changeView(3)" v-bind:style="displayView == 3 ? {color: 'var(--color-primary'} : ''">CreateTokens</div>
      <div @click="changeView(4)" v-bind:style="displayView == 4 ? {color: 'var(--color-primary'} : ''">{{isMobile?  "Connect" : "WalletConnect"}}</div>
      <div @click="changeView(5)">
        <img style="vertical-align: text-bottom;" v-bind:src="displayView == 5 ? 'images/settingsGreen.svg' : 
          settingsStore.darkMode? 'images/settingsLightGrey.svg' : 'images/settings.svg'">
      </div>
    </nav>
  </header>
  <main style="margin: 20px auto; max-width: 78rem;">
    <newWalletView v-if="!store.wallet" @init-wallet="(arg) => setWallet(arg)"/>
    <bchWalletView v-if="displayView == 1"/>
    <myTokensView v-if="displayView == 2"/>
    <createTokensView v-if="displayView == 3"/>
    <connectView v-if="displayView == 4" :dappUriUrlParam="dappUriUrlParam"/>
    <settingsMenu v-if="displayView == 5" @change-network="(arg) => changeNetwork(arg)" @change-view="(arg) => changeView(arg)"/>
  </main>
  <div v-if="transactionRequestWC">
    <WC2TransactionRequest :transactionRequestWC="transactionRequestWC" :dappMetadata="dappMetadata" @signed-transaction="(arg:string) => signedTransaction(arg)" @reject-transaction="rejectTransaction()"/>
  </div>
</template>
