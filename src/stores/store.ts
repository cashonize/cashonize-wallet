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
  balanceResponseFromSatoshi,
  type BalanceResponse,
  type UtxoI,
  type ElectrumNetworkProvider,
  type CancelFn,
  type HexHeaderI
} from "mainnet-js"
import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"
import {
  CurrencySymbols,
  type BcmrTokenMetadata,
  type TokenList,
  type BcmrIndexerResponse,
  type WalletHistoryReturnType
} from "../interfaces/interfaces"
import { queryAuthHeadTxid } from "../queryChainGraph"
import {
  getAllNftTokenBalances,
  getBalanceFromUtxos,
  getFungibleTokenBalances,
  getTokenUtxos
} from "src/utils/utils"
import { convertElectrumTokenData } from "src/utils/utils"
import { Notify } from "quasar";
import { useSettingsStore } from './settingsStore'
import { useWalletconnectStore } from "./walletconnectStore"
import { useCashconnectStore } from "./cashconnectStore"
import { displayAndLogError } from "src/utils/errorHandling"
import { cachedFetch } from "src/utils/cacheUtils"
const settingsStore = useSettingsStore()

// set mainnet-js config
Config.EnforceCashTokenReceiptAddresses = true;
Config.UseIndexedDBCache = true;
BaseWallet.StorageProvider = IndexedDBProvider;

const defaultBcmrIndexer = 'https://bcmr.paytaca.com/api';
const defaultBcmrIndexerChipnet = 'https://bcmr-chipnet.paytaca.com/api';

const nameWallet = 'mywallet';

const isDesktop = (process.env.MODE == "electron");

export const useStore = defineStore('store', () => {
  const displayView = ref(undefined as (number | undefined));
  // Wallet State
  // _wallet is the actual reactive wallet object and is null until the wallet is set
  // so _wallet is used for mutating properties of the wallet, like changing the provider
  const _wallet = ref(null as (Wallet | TestNetWallet | null));
  const balance = ref(undefined as (BalanceResponse | undefined));
  const maxAmountToSend = ref(undefined as (BalanceResponse | undefined));
  const walletUtxos = ref(undefined as (UtxoI[] | undefined));
  const walletHistory = ref(undefined as (WalletHistoryReturnType | undefined));
  const tokenList = ref(null as (TokenList | null))
  const plannedTokenId = ref(undefined as (undefined | string));
  const currentBlockHeight = ref(undefined as (number | undefined));
  const bcmrRegistries = ref(undefined as (Record<string, BcmrTokenMetadata> | undefined));
  const isWcInitialized = ref(false as boolean)
  const isCcInitialized = ref(false as boolean)
  const walletInitialized = ref(false as boolean)
  const latestGithubRelease = ref(undefined as undefined | string);

  // Computed properties
  const network = computed(() => wallet.value?.network == "mainnet" ? "mainnet" : "chipnet")
  const explorerUrl = computed(() => network.value == "mainnet" ? settingsStore.explorerMainnet : settingsStore.explorerChipnet);

  // The wallet computed property, throws if it were to be accessed when _wallet is null
  // The computed property should not be mutated, use _wallet instead
  const wallet = computed(() => {
    if (!_wallet.value) throw new Error('No wallet set in global store');
    return _wallet.value
  })

  const isWcAndCcInitialized =  computed(() => isWcInitialized.value && isCcInitialized.value)
  const nrBcmrRegistries = computed(() => bcmrRegistries.value ? Object.keys(bcmrRegistries.value) : undefined);
  const bcmrIndexer = computed(() => network.value == 'mainnet' ? defaultBcmrIndexer : defaultBcmrIndexerChipnet)

  let cancelWatchBchtxs: undefined | CancelFn;
  let cancelWatchTokenTxs: undefined | CancelFn;
  let cancelWatchBlocks: undefined | CancelFn;

  // Create a callback that triggers when we switch networks.
  let networkChangeCallbacks: Array<() => Promise<void>> = [];

  function changeView(newView: number) {
    displayView.value = newView;
  }

  async function setWallet(newWallet: Wallet | TestNetWallet){
    changeView(1);
    if(newWallet.network == 'mainnet'){
      const connectionMainnet = new Connection("mainnet", `wss://${settingsStore.electrumServerMainnet}:50004`)
      newWallet.provider = connectionMainnet.networkProvider as ElectrumNetworkProvider 
    }
    if(newWallet.network == 'testnet'){
      const connectionChipnet = new Connection("testnet", `wss://${settingsStore.electrumServerChipnet}:50004`)
      newWallet.provider = connectionChipnet.networkProvider as ElectrumNetworkProvider 
    }
    _wallet.value = newWallet;
    await initializeWallet();
  }

  async function initializeWallet() {
    let earlyError = false
    if(!_wallet.value) throw new Error("No Wallet set in global store")
    try {
      // attempt non-blocking connection to electrum server
      // wrapped the logic in an IIFE to avoid error bubbling up
      // otherwise this can cause the router to error (and UI to fail) in offline mode
      (() => {
        let timeoutHandle: ReturnType<typeof setTimeout>
        const electrumServer = network.value == 'mainnet' ? settingsStore.electrumServerMainnet : settingsStore.electrumServerChipnet
        Promise.race([wallet.value.provider.connect(),
          new Promise((_, reject) =>
            (timeoutHandle = setTimeout(() => {
              earlyError = true
              reject(new Error(`Unable to connect to Electrum server '${electrumServer}'`));
            }, 3000))
          )
        ]).finally(() => clearTimeout(timeoutHandle))
        .catch((error) => {displayAndLogError(error) });
      })();
      console.time('initialize walletconnect and cashconnect');
      await Promise.all([initializeWalletConnect(), initializeCashConnect()]);
      console.timeEnd('initialize walletconnect and cashconnect');
      // fetch wallet utxos first, this result will be used in consecutive calls
      // to avoid duplicate getAddressUtxos() calls
      console.time('fetch wallet utxos');
      const walletAddressUtxos = await wallet.value.getAddressUtxos()
      console.timeEnd('fetch wallet utxos');
      const balanceSats = getBalanceFromUtxos(walletAddressUtxos)
      // Fetch fiat balance and max amount to send in parallel
      // 'getMaxAmountToSend' combines multiple fetches (blockheight, relayfee, price) so is a bit slower
      console.time('fetch fiat balance & max amount to send');
      const promiseWalletBalance = balanceResponseFromSatoshi(balanceSats);
      const promiseMaxAmountToSend = wallet.value.getMaxAmountToSend({ options:{
        utxoIds: walletAddressUtxos
      }});
      const balancePromises = [promiseWalletBalance, promiseMaxAmountToSend];
      const [resultWalletBalance, resultMaxAmountToSend] = await Promise.all(balancePromises);
      console.timeEnd('fetch fiat balance & max amount to send');
      // set values simulatenously with tokenList so the UI elements load together
      balance.value = resultWalletBalance
      walletUtxos.value = walletAddressUtxos
      maxAmountToSend.value = resultMaxAmountToSend
      updateTokenList()
      console.time('set up wallet subscriptions');
      await setUpWalletSubscriptions();
      console.timeEnd('set up wallet subscriptions');
      if(!tokenList.value) return // should never happen
      if(isDesktop) getLatestGithubRelease()
      console.time('import registries');
      await importRegistries(tokenList.value, false);
      console.timeEnd('import registries');
      console.time('fetch history');
      await updateWalletHistory()
      console.timeEnd('fetch history');
      walletInitialized.value = true;
      // get plannedTokenId
      hasPreGenesis()
      // fetchAuthUtxos start last because it is not critical
      console.time('fetch authUtxos');
      await fetchAuthUtxos();
      console.timeEnd('fetch authUtxos');
    } catch (error) {
      if(!earlyError) displayAndLogError(error);
    } 
  }

  async function setUpWalletSubscriptions(){
    cancelWatchBchtxs = await wallet.value.watchBalance(async (newBalance) => {
      const oldBalance = balance.value;
      balance.value = newBalance;
      if(oldBalance?.sat && newBalance?.sat && walletInitialized.value){
        console.log("watchBalance")
        if(oldBalance.sat < newBalance.sat){
          const amountReceived = (newBalance.sat - oldBalance.sat) / 100_000_000
          const currencyValue = await convert(amountReceived, settingsStore.bchUnit, settingsStore.currency);
          const unitString = network.value == 'mainnet' ? 'BCH' : 'tBCH'
          Notify.create({
            type: 'positive',
            message: `Received ${amountReceived} ${unitString} (${currencyValue + CurrencySymbols[settingsStore.currency]})`
          })
        }
        // update state (but not on the initial trigger when creating the subscription)
        const walletAddressUtxos = await wallet.value.getAddressUtxos();
        walletUtxos.value = walletAddressUtxos;
        maxAmountToSend.value = await wallet.value.getMaxAmountToSend({ options:{
          utxoIds: walletAddressUtxos
        }});
        updateWalletHistory()
      }
    });
    const walletPkh = binToHex(wallet.value.getPublicKeyHash() as Uint8Array);
    cancelWatchTokenTxs = await wallet.value.watchAddressTokenTransactions(async(tx) => {
      const receivedTokenOutputs = tx.vout.filter(voutElem => voutElem.tokenData && voutElem.scriptPubKey.hex.includes(walletPkh));
      const previousTokenList = tokenList.value;
      const listNewTokens:TokenList = []
      // Check if transaction not initiated by user
      const userInputs = tx.vin.filter(vinElem => vinElem.address == wallet.value.cashaddr);
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
      // refetch utxos to update tokenList
      await updateWalletUtxos();
      updateWalletHistory()
    });
    cancelWatchBlocks = await wallet.value.watchBlocks((header: HexHeaderI) => {
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
    walletInitialized.value = false;
    // set new wallet
    const walletClass = (newNetwork == 'mainnet')? Wallet : TestNetWallet;
    const newWallet = await walletClass.named(nameWallet);
    setWallet(newWallet);
    localStorage.setItem('network', newNetwork);
    changeView(1);
  }

  async function initializeWalletConnect() {
    try {
      const walletconnectStore = await useWalletconnectStore(_wallet as Ref<Wallet>, changeNetwork)
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
    } catch (error) {
      console.error("Error initializing WalletConnect:", error);
      Notify.create({
        message: "Error initializing WalletConnect",
        icon: 'warning',
        color: "red"
      });
    }
  }

  async function initializeCashConnect() {
    try{
      // Initialize CashConnect.
      const cashconnectWallet = await useCashconnectStore(_wallet as Ref<Wallet>);

      // Start the wallet service.
      await cashconnectWallet.start();
      isCcInitialized.value = true;

      // Setup network change callback to disconnect all sessions.
      // NOTE: This must be wrapped, otherwise we don't have the appropriate context.
      networkChangeCallbacks.push(async () => {
        cashconnectWallet.cashConnectWallet.disconnectAllSessions();
      });

      // Monitor the wallet for balance changes.
      wallet.value.watchBalance(async () => {
        // Convert the network into WC format,
        const chainIdFormatted = wallet.value.network === 'mainnet' ? 'bch:bitcoincash' : 'bch:bchtest';

        // Invoke wallet state has changed so that CashConnect can retrieve fresh UTXOs (and token balances).
        cashconnectWallet.cashConnectWallet.walletStateHasChanged(chainIdFormatted);
      });
    } catch (error) {
      console.error("Error initializing CashConnect:", error);
      Notify.create({
        message: "Error initializing CashConnect",
        icon: 'warning',
        color: "red"
      });
    }
  }

  async function updateWalletUtxos() {
    try {
      walletUtxos.value = await wallet.value.getAddressUtxos();
      updateTokenList()
    } catch(error) {
      const errorMessage = typeof error == 'string' ? error : "Error in fetching wallet UTXOs";
      console.error(errorMessage)
      Notify.create({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      })
    }
  }

  async function updateWalletHistory() {
    try {
      console.log("updateWalletHistory")
      walletHistory.value = await wallet.value.getHistory({});
    } catch(error){
      console.error(error)
      const errorMessage = typeof error == 'string' ? error : "Error in fetching wallet history";
      console.error(errorMessage)
      Notify.create({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      })
    }
  }

  function updateTokenList() {
    if(!walletUtxos.value) return // should never happen
    const tokenUtxos = getTokenUtxos(walletUtxos.value);
    const fungibleTokensResult = getFungibleTokenBalances(tokenUtxos);
    const nftsResult = getAllNftTokenBalances(tokenUtxos);
    if(!fungibleTokensResult || !nftsResult) return // should never happen
    const arrayTokens: TokenList = [];
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
  }

  function sortTokenList(unsortedTokenList: TokenList) {
    // order the featuredTokenList according to the order in the settingStore
    const featuredTokenList: TokenList = []
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
          const metadataPromise = cachedFetch(`${bcmrIndexer.value}/tokens/${item.tokenId}/${nftEndpoint}/`);
          metadataPromises.push(metadataPromise);
        }
      } else {
        const metadataPromise = cachedFetch(`${bcmrIndexer.value}/tokens/${item.tokenId}/`);
        metadataPromises.push(metadataPromise);
      }
    }
    // MetadataPromises promises can be rejected in 'cachedFetch', the function should still return all fulfilled promises
    // so we use Promise.allSettled and handle the fulfilled results
    const resolveMetadataPromises = Promise.allSettled(metadataPromises);
    const resultsMetadata = await resolveMetadataPromises;
    const registries = bcmrRegistries.value ?? {};
    for(const settledResult of resultsMetadata) {
      const response = settledResult.status == "fulfilled" ? settledResult.value : undefined;
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
    const res = await cachedFetch(`${bcmrIndexer.value}/tokens/${categoryId}/`);
    if (!res.ok) throw new Error(`Failed to fetch token info: ${res.status}`);
  
    return await res.json() as BcmrIndexerResponse;
  }
  

  function hasPreGenesis(){
    plannedTokenId.value = undefined;
    const preGenesisUtxo = walletUtxos.value?.find(utxo => !utxo.token && utxo.vout === 0);
    plannedTokenId.value = preGenesisUtxo?.txid ?? "";
  }

  async function fetchAuthUtxos() {
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

  async function getLatestGithubRelease(){
    try {
      const response = await fetch('https://api.github.com/repos/cashonize/cashonize-wallet/releases/latest');
      if (!response.ok) throw new Error('Network response was not ok');
        
      const releaseData = await response.json();
      // Extract the version tag (e.g., 'v0.2.4')
      latestGithubRelease.value = releaseData.tag_name;
      console.log(latestGithubRelease.value)
    } catch (error) {
      console.error('Error fetching latest GitHub release:', error);
    }
  }

  return {
    nameWallet,
    displayView,
    _wallet, // the _wallet is the actual reactive wallet object but this can be null
    wallet, // computed property to access the wallet, always non-null
    balance,
    maxAmountToSend,
    walletUtxos,
    tokenList,
    walletHistory,
    plannedTokenId,
    isWcAndCcInitialized,
    latestGithubRelease,
    network,
    explorerUrl,
    bcmrRegistries,
    nrBcmrRegistries,
    currentBlockHeight,
    changeView,
    setWallet,
    initializeWallet,
    resetWalletState,
    updateWalletUtxos,
    updateWalletHistory,
    changeNetwork,
    fetchTokenInfo,
    hasPreGenesis,
    fetchAuthUtxos,
    importRegistries,
    toggleFavorite,
    tokenIconUrl
  }
})
