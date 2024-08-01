<script setup lang="ts">
  import newWalletView from 'src/components/newWallet.vue'
  import bchWalletView from 'src/components/bchWallet.vue'
  import myTokensView from 'src/components/myTokens.vue'
  import settingsMenu from 'src/components/settingsMenu.vue'
  import connectView from 'src/components/walletConnect.vue'
  import createTokensView from 'src/components/createTokens.vue'
  import walletHistoryView from 'src/components/history/walletHistory.vue'
  import WC2TransactionRequest from 'src/components/walletconnect/WC2TransactionRequest.vue';
  import WC2SignMessageRequest from 'src/components/walletconnect/WCSignMessageRequest.vue'
  import { ref, computed } from 'vue'
  import { Wallet, TestNetWallet, BalanceResponse, binToHex, Connection, ElectrumNetworkProvider } from 'mainnet-js'
  import type { CancelWatchFn, HexHeaderI } from 'mainnet-js';
  import { convertElectrumTokenData } from "src/utils/utils"
  import type { TokenData, TokenList } from "../interfaces/interfaces"
  import type { Web3WalletTypes } from '@walletconnect/web3wallet';
  import { useStore, featuredTokens } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  import { useQuasar } from 'quasar'
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const walletconnectStore = useWalletconnectStore()
  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const props = defineProps<{
    uri: string | undefined
  }>()

  const nameWallet = 'mywallet';
  let cancelWatchBchtxs: undefined | CancelWatchFn;
  let cancelWatchTokenTxs: undefined | CancelWatchFn;
  let cancelWatchBlocks: undefined | CancelWatchFn;

  const displayView = ref(undefined as (number | undefined));
  const transactionRequestWC = ref(undefined as any);
  const signMessageRequestWC = ref(undefined as any);
  const dappMetadata = ref(undefined as any);
  const dappUriUrlParam = ref(undefined as undefined|string);

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
    if(newWallet.network == 'mainnet'){
      const connectionMainnet = new Connection("mainnet", `wss://${settingsStore.electrumServerMainnet}:50004`)
      newWallet.provider = connectionMainnet.networkProvider as ElectrumNetworkProvider 
    }
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
    const promiseWalletBalance = store.wallet.getBalance() as Promise<BalanceResponse>;
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
    setUpWalletSubscriptions();
    // get plannedTokenId
    if(!store.tokenList) return // should never happen
    console.time('importRegistries');
    await Promise.all([
      store.importRegistries(store.tokenList, false),
      store.importRegistries(featuredTokens.map((tokenId: string) => ({tokenId} as TokenData)), false),
    ]);
    console.timeEnd('importRegistries');
    console.time('planned tokenid');
    await store.hasPreGenesis()
    console.timeEnd('planned tokenid');
    console.time('fetchAuthUtxos');
    await store.fetchAuthUtxos();
    console.timeEnd('fetchAuthUtxos');
  }

  async function setUpWalletSubscriptions(){
    cancelWatchBchtxs = store.wallet?.watchBalance(async (newBalance) => {
      const oldBalance = store.balance;
      store.balance = newBalance;
      if(oldBalance?.sat && newBalance?.sat){
        if(oldBalance.sat < newBalance.sat){
          const amountReceived = (newBalance.sat - oldBalance.sat) / 100_000_000
          const unitString = store.network == 'mainnet' ? 'BCH' : 'tBCH'
          $q.notify({
            type: 'positive',
            message: `Received ${amountReceived} ${unitString}`
          })
        }
      }
      store.maxAmountToSend = await store.wallet?.getMaxAmountToSend();
      store.shouldReloadHistory = true;
    });
    cancelWatchTokenTxs = store.wallet?.watchAddressTokenTransactions(async(tx) => {
      if(!store.wallet) return // should never happen
      const walletPkh = binToHex(store.wallet.getPublicKeyHash() as Uint8Array);
      const tokenOutputs = tx.vout.filter(voutElem => voutElem.tokenData && voutElem.scriptPubKey.hex.includes(walletPkh));
      const previousTokenList = store.tokenList;
      const listNewTokens:TokenList = []
      // Check if transaction not initiated by user
      const userInputs = tx.vin.filter(vinElem => vinElem.address == store.wallet?.address);
      for(const tokenOutput of tokenOutputs){
        if(!userInputs.length){
          const tokenType = tokenOutput?.tokenData?.nft ? "NFT" : "tokens"
          $q.notify({
            type: 'positive',
            message: `Received new ${tokenType}`
          })
        }
        const tokenId = tokenOutput?.tokenData?.category;
        const isNewTokenItem = !previousTokenList?.find(elem => elem.tokenId == tokenId);
        if(!tokenId && !isNewTokenItem) continue;
        const newTokenItem = convertElectrumTokenData(tokenOutput?.tokenData)
        if(newTokenItem) listNewTokens.push(newTokenItem)
      }
      // Dynamically import tokenmetadata
      await store.importRegistries(listNewTokens, true);
      await store.updateTokenList();
    });
    cancelWatchBlocks = store.wallet?.watchBlocks((header: HexHeaderI) => {
      store.currentBlockHeight = header.height;
    }, false);
  }

  async function changeNetwork(newNetwork: 'mainnet' | 'chipnet'){
    // cancel active listeners
    cancelWatchBchtxs?.()
    cancelWatchTokenTxs?.()
    cancelWatchBlocks?.()

    const walletClass = (newNetwork == 'mainnet')? Wallet : TestNetWallet;
    const newWallet = await walletClass.named(nameWallet);
    setWallet(newWallet);
    localStorage.setItem('network', newNetwork);
    // reset wallet to default state
    store.balance = undefined;
    store.maxAmountToSend = undefined;
    store.plannedTokenId = undefined;
    store.tokenList = null;
    store.bcmrRegistries = {};
    changeView(1);
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
        const sessions = web3wallet.getActiveSessions();
        const session = sessions[topic];
        if (!session) return;
        const metadataDapp = session.peer.metadata;
        dappMetadata.value = metadataDapp
        signMessageRequestWC.value = event;
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
    transactionRequestWC.value = undefined;
    $q.notify({
      type: 'positive',
      message: 'Transaction succesfully sent!'
    })
    $q.notify({
      icon: 'info',
      timeout : 5000,
      color: "grey-6",
      message: 'Txid:' + txId
    })
  }
  function rejectTransaction(){
    transactionRequestWC.value = undefined;
  }
  // Reset signMessageRequestWC after sign or reject
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
    <nav v-if="displayView" style="display: flex; justify-content: center;" class="tabs">
      <div @click="changeView(1)" v-bind:style="displayView == 1 ? {color: 'var(--color-primary'} : ''">BchWallet</div>
      <div @click="changeView(2)" v-bind:style="displayView == 2 ? {color: 'var(--color-primary'} : ''">MyTokens</div>
      <div v-if="!isMobile && settingsStore.tokenCreation" @click="changeView(3)" v-bind:style="displayView == 3 ? {color: 'var(--color-primary'} : ''">CreateTokens</div>
      <div v-if="settingsStore.walletConnect" @click="changeView(4)" v-bind:style="displayView == 4 ? {color: 'var(--color-primary'} : ''">{{isMobile?  "Connect" : "WalletConnect"}}</div>
      <div @click="changeView(5)" v-bind:style="displayView == 5 ? {color: 'var(--color-primary'} : ''">History</div>
      <div @click="changeView(6)">
        <img style="vertical-align: text-bottom;" v-bind:src="displayView == 6 ? 'images/settingsGreen.svg' : 
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
    <walletHistoryView v-if="displayView == 5"/>
    <settingsMenu v-if="displayView == 6" @change-network="(arg) => changeNetwork(arg)" @change-view="(arg) => changeView(arg)"/>
  </main>
  <div v-if="transactionRequestWC">
    <WC2TransactionRequest :transactionRequestWC="transactionRequestWC" :dappMetadata="dappMetadata" @signed-transaction="(arg:string) => signedTransaction(arg)" @reject-transaction="rejectTransaction()"/>
  </div>
  <div v-if="signMessageRequestWC">
    <WC2SignMessageRequest :signMessageRequestWC="signMessageRequestWC" :dappMetadata="dappMetadata" @sign-message="() => signMessage()" @reject-sign-message="rejectSignMessage()"/>
  </div>
</template>
