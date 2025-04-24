import { defineStore } from "pinia"
import { ref, computed, type Ref } from 'vue'
import {
  Wallet,
  TestNetWallet,
  BaseWallet,
  Config,
  Connection,
  binToHex,
  convert,
  type BalanceResponse,
  type UtxoI,
  type ElectrumNetworkProvider,
  type CancelWatchFn,
  type HexHeaderI
} from "mainnet-js"
import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"
import { CurrencySymbols, type BcmrTokenMetadata, type TokenList, type BcmrIndexerResponse } from "../interfaces/interfaces"
import { queryAuthHeadTxid } from "../queryChainGraph"
import { getAllNftTokenBalances, getFungibleTokenBalances } from "src/utils/utils"
import { convertElectrumTokenData } from "src/utils/utils"
import { Notify } from "quasar";
import { useSettingsStore } from './settingsStore'
import { useWalletconnectStore } from "./walletconnectStore"
import { useCashconnectStore } from "./cashconnectStore"
import { displayAndLogError } from "src/utils/errorHandling"
const settingsStore = useSettingsStore()

// set mainnet-js config
Config.EnforceCashTokenReceiptAddresses = true;
Config.UseIndexedDBCache = true;
BaseWallet.StorageProvider = IndexedDBProvider;

const defaultBcmrIndexer = 'https://bcmr.paytaca.com/api';
const defaultBcmrIndexerChipnet = 'https://bcmr-chipnet.paytaca.com/api';

const nameWallet = 'mywallet';

type WalletHistoryReturnType = Awaited<ReturnType<Wallet['getHistory']>>;

export const useStore = defineStore('store', () => {
  const displayView = ref(undefined as (number | undefined));
  // Wallet State
  const wallet = ref(null as (Wallet | TestNetWallet | null));
  const balance = ref(undefined as (BalanceResponse | undefined));
  const maxAmountToSend = ref(undefined as (BalanceResponse | undefined));
  const network = computed(() => wallet.value?.network == "mainnet" ? "mainnet" : "chipnet")
  const explorerUrl = computed(() => network.value == "mainnet" ? settingsStore.explorerMainnet : settingsStore.explorerChipnet);
  const walletHistory = ref(undefined as (WalletHistoryReturnType | undefined));
  const tokenList = ref(null as (TokenList | null))
  const plannedTokenId = ref(undefined as (undefined | string));
  const currentBlockHeight = ref(undefined as (number | undefined));
  const bcmrRegistries = ref(undefined as (Record<string, BcmrTokenMetadata> | undefined));
  const isWcInitialized = ref(false as boolean)
  const isCcInitialized = ref(false as boolean)

  const isWcAndCcInitialized =  computed(() => isWcInitialized.value && isCcInitialized.value)
  const nrBcmrRegistries = computed(() => bcmrRegistries.value ? Object.keys(bcmrRegistries.value) : undefined);
  const bcmrIndexer = computed(() => network.value == 'mainnet' ? defaultBcmrIndexer : defaultBcmrIndexerChipnet)

  let cancelWatchBchtxs: undefined | CancelWatchFn;
  let cancelWatchTokenTxs: undefined | CancelWatchFn;
  let cancelWatchBlocks: undefined | CancelWatchFn;

  // Create a callback that triggers when we switch networks.
  let networkChangeCallbacks: Array<() => Promise<void>> = [];

  function changeView(newView: number) {
    displayView.value = newView;
  }

  async function setWallet(newWallet: TestNetWallet){
    changeView(1);
    if(newWallet.network == 'mainnet'){
      const connectionMainnet = new Connection("mainnet", `wss://${settingsStore.electrumServerMainnet}:50004`)
      newWallet.provider = connectionMainnet.networkProvider as ElectrumNetworkProvider 
    }
    if(newWallet.network == 'testnet'){
      const connectionChipnet = new Connection("testnet", `wss://${settingsStore.electrumServerChipnet}:50004`)
      newWallet.provider = connectionChipnet.networkProvider as ElectrumNetworkProvider 
    }
    wallet.value = newWallet;
    await initializeWallet();
  }

  async function initializeWallet() {
    let earlyError = false
    if(!wallet.value) throw new Error("No Wallet set in global store")
    try {
      // attempt non-blocking connection to electrum server
      let timeoutHandle: ReturnType<typeof setTimeout>
      const electrumServer = network.value == 'mainnet' ? settingsStore.electrumServerMainnet : settingsStore.electrumServerChipnet
      Promise.race([wallet.value.provider?.connect(),
        new Promise((_, reject) =>
          (timeoutHandle = setTimeout(() => {
            earlyError = true
            reject(new Error(`Unable to connect to Electrum server '${electrumServer}'`));
          }, 3000))
        )
      ]).finally(() => clearTimeout(timeoutHandle))
      .catch((error) => {displayAndLogError(error) });
      console.time('initialize walletconnect and cashconnect');
      await Promise.all([initializeWalletConnect(), initializeCashConnect()]);
      console.timeEnd('initialize walletconnect and cashconnect');
      setUpWalletSubscriptions();
      // fetch bch balance
      console.time('Balance Promises');
      const promiseWalletBalance = wallet.value.getBalance();
      const promiseMaxAmountToSend = wallet.value.getMaxAmountToSend();
      const balancePromises = [promiseWalletBalance, promiseMaxAmountToSend];
      const [resultWalletBalance, resultMaxAmountToSend] = await Promise.all(balancePromises);
      console.timeEnd('Balance Promises');
      // fetch token balance
      console.time('fetch tokenUtxos Promise');
      await updateTokenList();
      console.timeEnd('fetch tokenUtxos Promise');
      // set values simulatenously with tokenList so the UI elements load together
      balance.value = resultWalletBalance as BalanceResponse;
      maxAmountToSend.value = resultMaxAmountToSend as BalanceResponse;
      // get plannedTokenId
      if(!tokenList.value) return // should never happen
      console.time('importRegistries');
      await importRegistries(tokenList.value, false);
      console.timeEnd('importRegistries');
      console.time('fetch history');
      await updateWalletHistory()
      console.timeEnd('fetch history');
      hasPreGenesis()
      // fetchAuthUtxos start last because it is not critical
      console.time('fetchAuthUtxos');
      await fetchAuthUtxos();
      console.timeEnd('fetchAuthUtxos');
    } catch (error) {
      if(!earlyError) displayAndLogError(error);
    } 
  }

  function setUpWalletSubscriptions(){
    cancelWatchBchtxs = wallet.value?.watchBalance(async (newBalance) => {
      const oldBalance = balance.value;
      balance.value = newBalance;
      if(oldBalance?.sat && newBalance?.sat){
        if(oldBalance.sat < newBalance.sat){
          const amountReceived = (newBalance.sat - oldBalance.sat) / 100_000_000
          const currencyValue = await convert(amountReceived, settingsStore.bchUnit, settingsStore.currency);
          const unitString = network.value == 'mainnet' ? 'BCH' : 'tBCH'
          Notify.create({
            type: 'positive',
            message: `Received ${amountReceived} ${unitString} (${currencyValue + CurrencySymbols[settingsStore.currency]})`
          })
        }
      }
      maxAmountToSend.value = await wallet.value?.getMaxAmountToSend();
      updateWalletHistory()
    });
    const walletPkh = binToHex(wallet.value?.getPublicKeyHash() as Uint8Array);
    cancelWatchTokenTxs = wallet.value?.watchAddressTokenTransactions(async(tx) => {      
      const receivedTokenOutputs = tx.vout.filter(voutElem => voutElem.tokenData && voutElem.scriptPubKey.hex.includes(walletPkh));
      const previousTokenList = tokenList.value;
      const listNewTokens:TokenList = []
      // Check if transaction not initiated by user
      const userInputs = tx.vin.filter(vinElem => vinElem.address == wallet.value?.address);
      for(const tokenOutput of receivedTokenOutputs){
        if(!userInputs.length){
          const tokenType = tokenOutput?.tokenData?.nft ? "NFT" : "tokens"
          Notify.create({
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
      await importRegistries(listNewTokens, true);
      await updateTokenList();
      updateWalletHistory()
    });
    cancelWatchBlocks = wallet.value?.watchBlocks((header: HexHeaderI) => {
      currentBlockHeight.value = header.height;
    }, false);
  }

  function resetWalletState(){
    // Execute each of our network changed callbacks.
    // In practice, we're using these for WC/CC to disconnect their sessions.
    networkChangeCallbacks.forEach((callback) => callback());
    // clear the networkChangeCallbacks before initialising newWallet 
    networkChangeCallbacks = []

    // cancel active listeners
    if(cancelWatchBchtxs && cancelWatchTokenTxs && cancelWatchBlocks){
      cancelWatchBchtxs()
      cancelWatchTokenTxs()
      cancelWatchBlocks()
    }
    // reset wallet to default state
    balance.value = undefined;
    maxAmountToSend.value = undefined;
    plannedTokenId.value = undefined;
    tokenList.value = null;
    bcmrRegistries.value = undefined;
    walletHistory.value = undefined;
  }

  async function changeNetwork(newNetwork: 'mainnet' | 'chipnet'){
    resetWalletState()
    // set new wallet
    const walletClass = (newNetwork == 'mainnet')? Wallet : TestNetWallet;
    const newWallet = await walletClass.named(nameWallet);
    setWallet(newWallet);
    localStorage.setItem('network', newNetwork);
    changeView(1);
  }

  async function initializeWalletConnect() {
    const walletconnectStore = await useWalletconnectStore(wallet as Ref<Wallet>, changeNetwork)
    await walletconnectStore.initweb3wallet();
    isWcInitialized.value = true;

    // Setup network change callback to disconnect all sessions.
    networkChangeCallbacks.push(async () => {
      const sessions = walletconnectStore.web3wallet?.getActiveSessions();
      if(!sessions) return

      for (const session of Object.values(sessions)) {
        walletconnectStore.web3wallet?.disconnectSession({
          topic: session.topic,
          reason: {
            code: 5000,
            message: "User rejected",
          },
        });
      }
    });
  }

  async function initializeCashConnect() {
    // Initialize CashConnect.
    const cashconnectWallet = await useCashconnectStore(wallet as Ref<Wallet>);

    // Start the wallet service.
    await cashconnectWallet.start();
    isCcInitialized.value = true;

    // Setup network change callback to disconnect all sessions.
    // NOTE: This must be wrapped, otherwise we don't have the appropriate context.
    networkChangeCallbacks.push(async () => {
      cashconnectWallet.cashConnectWallet.disconnectAllSessions();
    });

    // Monitor the wallet for balance changes.
    wallet.value?.watchBalance(async () => {
      // Convert the network into WC format,
      const chainIdFormatted = wallet.value?.network === 'mainnet' ? 'bch:bitcoincash' : 'bch:bchtest';

      // Invoke wallet state has changed so that CashConnect can retrieve fresh UTXOs (and token balances).
      cashconnectWallet.cashConnectWallet.walletStateHasChanged(chainIdFormatted);
    });
  }

  async function updateWalletHistory() {
    try {
      walletHistory.value = await wallet.value?.getHistory({});
    } catch(error){
      const errorMessage = typeof error == 'string' ? error : "something went wrong";
      console.error(errorMessage)
      Notify.create({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      })
    }
  }

  async function updateTokenList() {
    if(!wallet.value) return // should never happen
    const tokenUtxos = await wallet.value.getTokenUtxos();
    const fungibleTokensResult = getFungibleTokenBalances(tokenUtxos);
    const nftsResult = getAllNftTokenBalances(tokenUtxos);
    if(!fungibleTokensResult || !nftsResult) return // should never happen
    const arrayTokens:TokenList = [];
    for (const tokenId of Object.keys(fungibleTokensResult)) {
      const fungibleTokenAmount = fungibleTokensResult[tokenId]
      if(!fungibleTokenAmount) continue // should never happen
      arrayTokens.push({ tokenId, amount: fungibleTokenAmount });
    }
    for (const tokenId of Object.keys(nftsResult)) {
      const utxosNftTokenid = tokenUtxos.filter((val) =>val.token?.tokenId === tokenId);
      arrayTokens.push({ tokenId, nfts: utxosNftTokenid });
    }
    // sort tokenList with featuredTokens first
    sortTokenList(arrayTokens);
    const catgeories = Object.keys({...fungibleTokensResult, ...nftsResult})
    return catgeories;
  }

  function sortTokenList(unsortedTokenList: TokenList) {
    // order the featuredTokenList according to the order in the settingStore
    const featuredTokenList:TokenList = []
    for(const featuredToken of settingsStore.featuredTokens){
      // if featuredToken in unsortedTokenList, add it to a featuredTokenList
      const featuredTokenItem = unsortedTokenList.find(token => token.tokenId === featuredToken);
      if(featuredTokenItem) featuredTokenList.push(featuredTokenItem)
    }
    const otherTokenList = unsortedTokenList.filter(token => !settingsStore.featuredTokens.includes(token.tokenId));

    tokenList.value = [...featuredTokenList, ...otherTokenList];
  }

  // Import onchain resolved BCMRs
  async function importRegistries(tokenList: TokenList, fetchNftInfo: boolean) {
    const metadataPromises = [];
    for (const item of tokenList) {
      if('nfts' in item && (fetchNftInfo || Object.keys(item.nfts).length == 1)) {
        const listCommitments = item.nfts.map(nftItem => nftItem.token?.commitment)
        const uniqueCommitments = new Set(listCommitments);
        for(const nftCommitment of uniqueCommitments) {
          const nftEndpoint = nftCommitment ? nftCommitment : "empty"
          const metadataPromise = fetch(`${bcmrIndexer.value}/tokens/${item.tokenId}/${nftEndpoint}/`);
          metadataPromises.push(metadataPromise);
        }
      } else {
        const metadataPromise = fetch(`${bcmrIndexer.value}/tokens/${item.tokenId}/`);
        metadataPromises.push(metadataPromise);
      }
    }
    const resolveMetadataPromsises = Promise.all(metadataPromises);
    const resultsMetadata = await resolveMetadataPromsises;
    const registries = bcmrRegistries.value ?? {};
    for(const response of resultsMetadata) {
      if(response?.status == 200) {
        const jsonResponse:BcmrIndexerResponse = await response.json();
        const tokenId = jsonResponse?.token?.category
        if(jsonResponse?.type_metadata) {
          const nftEndpoint = response.url.split("/").at(-2) as string;
          const commitment = nftEndpoint != "empty"? nftEndpoint : "";
          if(!registries[tokenId]) registries[tokenId] = jsonResponse;
          if(!registries[tokenId]?.nfts) registries[tokenId].nfts = {}
          registries[tokenId].nfts[commitment] = jsonResponse?.type_metadata
        } else {
          if(!registries[tokenId]) registries[tokenId] = jsonResponse;
        }
      }
    }
    bcmrRegistries.value = registries
  }

  async function fetchTokenInfo(categoryId: string) {
    const res = await fetch(`${bcmrIndexer.value}/tokens/${categoryId}/`);
    if (!res.ok) throw new Error(`Failed to fetch token info: ${res.status}`);
  
    return await res.json() as BcmrIndexerResponse;
  }
  

  async function hasPreGenesis(){
    plannedTokenId.value = undefined;
    const walletUtxos = await wallet.value?.getAddressUtxos();
    const preGenesisUtxo = walletUtxos?.find(utxo => !utxo.token && utxo.vout === 0);
    plannedTokenId.value = preGenesisUtxo?.txid ?? "";
  }

  async function fetchAuthUtxos() {
    if(!wallet.value) return // should never happen
    if(!tokenList.value?.length) return
    const copyTokenList = [...tokenList.value]
    // get all tokenUtxos
    const tokenUtxosPromise: Promise<UtxoI[]> = wallet.value.getTokenUtxos();
    // get all authHeadTxIds in parallel
    const authHeadTxIdPromises: Promise<string | undefined>[] = [];
    for (const token of tokenList.value){
      const fetchAuthHeadPromise = queryAuthHeadTxid(token.tokenId, settingsStore.chaingraph)
      authHeadTxIdPromises.push(fetchAuthHeadPromise)
    }
    const tokenUtxosResult = await tokenUtxosPromise;
    const authHeadTxIdResults = await Promise.all(authHeadTxIdPromises);
    if(authHeadTxIdResults.includes(undefined)) console.error("ChainGraph instance not returning all authHeadTxIds")
    // check if any tokenUtxo of category is the authUtxo for that category
    copyTokenList.forEach((token, index) => {
      const authHeadTxId = authHeadTxIdResults[index];
      const filteredTokenUtxos = tokenUtxosResult.filter(
        (tokenUtxos) => tokenUtxos.token?.tokenId === token.tokenId
      );
      const authUtxo = filteredTokenUtxos.find(utxo => utxo.txid == authHeadTxId && utxo.vout == 0);
      if(authUtxo) token.authUtxo = authUtxo;
    })
    tokenList.value = copyTokenList;
  }

  function toggleFavorite(tokenId: string) {
    // Remove token from featuredTokens if it's already there, otherwise add it
    const newFeaturedTokens = settingsStore.featuredTokens.includes(tokenId) ?
      settingsStore.featuredTokens.filter((id) => id !== tokenId) :
      [...settingsStore.featuredTokens, tokenId];
    // save the new featuredTokens to local storage
    localStorage.setItem("featuredTokens", JSON.stringify(newFeaturedTokens));
    settingsStore.featuredTokens = newFeaturedTokens;
    // actually change the UI list by updating the state
    sortTokenList(tokenList.value as TokenList);
  }

  function tokenIconUrl(tokenId: string) {
    const tokenIconUri = bcmrRegistries.value?.[tokenId]?.uris?.icon;
    if (!tokenIconUri) return undefined;

    if (tokenIconUri.startsWith('ipfs://')) {
      return settingsStore.ipfsGateway + tokenIconUri.slice(7);
    } else {
      return tokenIconUri;
    }
  }

  return {
    nameWallet,
    displayView,
    wallet,
    balance,
    maxAmountToSend,
    network,
    explorerUrl,
    tokenList,
    walletHistory,
    plannedTokenId,
    isWcAndCcInitialized,
    bcmrRegistries,
    nrBcmrRegistries,
    currentBlockHeight,
    changeView,
    setWallet,
    initializeWallet,
    resetWalletState,
    updateWalletHistory,
    changeNetwork,
    fetchTokenInfo,
    updateTokenList,
    hasPreGenesis,
    fetchAuthUtxos,
    importRegistries,
    toggleFavorite,
    tokenIconUrl
  }
})
