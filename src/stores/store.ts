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
  NetworkType
} from "mainnet-js"
import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"
import {
  CurrencySymbols,
  type BcmrTokenMetadata,
  type TokenList,
  type WalletHistoryReturnType
} from "../interfaces/interfaces"
import {
  getBalanceFromUtxos,
  getTokenUtxos,
  runAsyncVoid
} from "src/utils/utils"
import {
  importBcmrRegistries,
  tokenListFromUtxos,
  updateTokenListWithAuthUtxos
} from "./storeUtils"
import { convertElectrumTokenData } from "src/utils/utils"
import { Notify } from "quasar";
import { useSettingsStore } from './settingsStore'
import { useWalletconnectStore } from "./walletconnectStore"
import { useCashconnectStore } from "./cashconnectStore"
import { displayAndLogError } from "src/utils/errorHandling"
import { cachedFetch } from "src/utils/cacheUtils"
import { BcmrIndexerResponseSchema } from "src/utils/zodValidation"
import { deleteWalletFromDb, getAllWalletsWithNetworkInfo, type WalletInfo } from "src/utils/dbUtils"
const settingsStore = useSettingsStore()

// set mainnet-js config
Config.EnforceCashTokenReceiptAddresses = true;
Config.UseIndexedDBCache = true;
BaseWallet.StorageProvider = IndexedDBProvider;

const defaultBcmrIndexer = 'https://bcmr.paytaca.com/api';
const defaultBcmrIndexerChipnet = 'https://bcmr-chipnet.paytaca.com/api';

const defaultWalletName = 'mywallet';

const isDesktop = (process.env.MODE == "electron");

export const useStore = defineStore('store', () => {
  const displayView = ref(undefined as (number | undefined));
  // Multi-wallet state
  const activeWalletName = ref(localStorage.getItem('activeWalletName') ?? defaultWalletName);
  const availableWallets = ref([] as WalletInfo[]);
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
  const network = computed(() => wallet.value.network == NetworkType.Mainnet ? "mainnet" : "chipnet") 
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

  // setWallet is a simple wrapper "set" function for the internal _wallet in the store.
  // It adds the configured electrum network provider on the wallet depending on the network.
  // Call initializeWallet() afterwards to actually connect to the electrum client and to fetch initial data.
  function setWallet(newWallet: Wallet | TestNetWallet){
    if(newWallet.network == NetworkType.Mainnet){ 
      const connectionMainnet = new Connection("mainnet", `wss://${settingsStore.electrumServerMainnet}:50004`)
      // @ts-ignore currently no other way to set a specific provider
      newWallet.provider = connectionMainnet.networkProvider as ElectrumNetworkProvider 
    }
    if(newWallet.network == NetworkType.Testnet){ 
      const connectionChipnet = new Connection("testnet", `wss://${settingsStore.electrumServerChipnet}:50004`)
      // @ts-ignore currently no other way to set a specific provider
      newWallet.provider = connectionChipnet.networkProvider as ElectrumNetworkProvider 
    }
    _wallet.value = newWallet;
  }

  async function initializeWallet() {
    let failedToConnectElectrum = false
    if(!_wallet.value) throw new Error("No Wallet set in global store")
    try {
      // attempt non-blocking connection to electrum server
      // wrapped the logic in an IIFE to avoid error bubbling up
      // otherwise this can cause the router to error (and UI to fail) in offline mode
      let electrumConnectionPromise: Promise<unknown>
      (() => {
        let timeoutHandle: ReturnType<typeof setTimeout>
        const electrumServer = network.value == 'mainnet' ? settingsStore.electrumServerMainnet : settingsStore.electrumServerChipnet
        electrumConnectionPromise = Promise.race([
          wallet.value.provider.connect(),
          new Promise((_, reject) =>
            (timeoutHandle = setTimeout(() => {
              reject(new Error("ELECTRUM_CONNECT_TIMEOUT"));
            }, 3000))
          )
        ]).finally(() => clearTimeout(timeoutHandle))
        .catch(error => {
          failedToConnectElectrum = true;
          displayAndLogError(new Error(`Unable to connect to Electrum server '${electrumServer}'`))
          // still log the original error for debugging
          console.error("Electrum connect error:", error)
        });
      })();
      console.time('initialize walletconnect and cashconnect');
      await Promise.all([initializeWalletConnect(), initializeCashConnect()]);
      console.timeEnd('initialize walletconnect and cashconnect');
      // wait until the electrumConnectionPromise is resolved
      await electrumConnectionPromise;
      // if electrum connection failed, cancel the rest of initialization
      if(failedToConnectElectrum) return
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
      const promiseMaxAmountToSend = wallet.value.getMaxAmountToSend({
        options: { utxoIds: walletAddressUtxos }
      });
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
      // fire-and-forget getLatestGithubRelease promise for desktop platform
      if(isDesktop) void getLatestGithubRelease()
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
      if(settingsStore.authchains){
        console.time('fetch authUtxos');
        await fetchAuthUtxos();
        console.timeEnd('fetch authUtxos');
      }
    } catch (error) {
      displayAndLogError(error);
    } 
  }

  async function setUpWalletSubscriptions(){
    cancelWatchBchtxs = await wallet.value.watchBalance(
      // use runAsyncVoid to wrap an async function as a synchronous callback
      // this means the promise is fire-and-forget
      (newBalance) => runAsyncVoid(async () => {
        const oldBalance = balance.value;
        balance.value = newBalance;
        if(oldBalance?.sat && newBalance.sat && walletInitialized.value){
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
          // update wallet history as fire-and-forget promise
          void updateWalletHistory()
        }
      })
    );
    const walletPkh = binToHex(wallet.value.getPublicKeyHash() as Uint8Array);
    cancelWatchTokenTxs = await wallet.value.watchAddressTokenTransactions(
      // use runAsyncVoid to wrap an async function as a synchronous callback
      // this means the promise is fire-and-forget
      (tx) => runAsyncVoid(async () => {
        const receivedTokenOutputs = tx.vout.filter(voutElem =>
          voutElem.tokenData && voutElem.scriptPubKey.hex.includes(walletPkh)
        );
        const previousTokenList = tokenList.value;
        const listNewTokens:TokenList = []
        // Check if transaction not initiated by user
        const userInputs = tx.vin.filter(vinElem => vinElem.address == wallet.value.cashaddr);
        for(const tokenOutput of receivedTokenOutputs){
          if(!userInputs.length){
            const tokenType = tokenOutput.tokenData?.nft ? "NFT" : "tokens"
            Notify.create({
              type: 'positive',
              message: `Received new ${tokenType}`
            })
          }
          const tokenId = tokenOutput.tokenData?.category;
          const isNewTokenItem = !previousTokenList?.find(elem => elem.tokenId == tokenId);
          if(!tokenId && !isNewTokenItem) continue;
          const newTokenItem = convertElectrumTokenData(tokenOutput.tokenData)
          if(newTokenItem) listNewTokens.push(newTokenItem)
        }
        // Dynamically import tokenmetadata
        await importRegistries(listNewTokens, true);
        // refetch utxos to update tokenList
        await updateWalletUtxos();
        // update wallet history as fire-and-forget promise
        void updateWalletHistory()
      })
    );
    cancelWatchBlocks = await wallet.value.watchBlocks(header => {
      currentBlockHeight.value = header.height;
    }, false);
  }

  function resetWalletState(){
    // Execute each of our network changed callbacks.
    // In practice, we're using these for WC/CC to disconnect their sessions.
    // TODO: investigate if disconnecting session this way is properly working
    // Call disconnects as fire-and-forget promises
    networkChangeCallbacks.forEach((callback) => void callback());
    // clear the networkChangeCallbacks before initialising newWallet 
    networkChangeCallbacks = []

    // cancel active listeners
    if(cancelWatchBchtxs && cancelWatchTokenTxs && cancelWatchBlocks){
      void cancelWatchBchtxs()
      void cancelWatchTokenTxs()
      void cancelWatchBlocks()
    }
    // reset wallet to default state
    balance.value = undefined;
    maxAmountToSend.value = undefined;
    plannedTokenId.value = undefined;
    tokenList.value = null;
    bcmrRegistries.value = undefined;
    walletHistory.value = undefined;
  }

  async function changeNetwork(
    newNetwork: 'mainnet' | 'chipnet',
    awaitWalletInitialization: boolean = false
  ){
    resetWalletState()
    walletInitialized.value = false;
    // set new wallet
    const walletClass = (newNetwork == 'mainnet')? Wallet : TestNetWallet;
    const newWallet = await walletClass.named(activeWalletName.value);
    setWallet(newWallet);
    if (awaitWalletInitialization) {
      await initializeWallet();
    } else {
      // fire-and-forget promise does not wait on full wallet initialization
      void initializeWallet();
    }
    localStorage.setItem('network', newNetwork);
    changeView(1);
  }

  async function switchWallet(walletName: string) {
    activeWalletName.value = walletName;
    localStorage.setItem('activeWalletName', walletName);
    // Get the current network from localStorage (default to mainnet)
    const currentNetwork = (localStorage.getItem('network') ?? 'mainnet') as 'mainnet' | 'chipnet';
    // Re-initialize wallet
    resetWalletState();
    walletInitialized.value = false;
    const walletClass = (currentNetwork == 'mainnet') ? Wallet : TestNetWallet;
    const newWallet = await walletClass.named(walletName);
    setWallet(newWallet);
    changeView(1);
    // fire-and-forget - don't await so UI is responsive
    void initializeWallet();
  }

  async function refreshAvailableWallets() {
    // Get wallet info from both mainnet and chipnet databases
    availableWallets.value = await getAllWalletsWithNetworkInfo();
  }

  async function deleteWallet(walletName: string) {
    if (walletName === activeWalletName.value) {
      throw new Error("Cannot delete the currently active wallet");
    }
    // Delete from both mainnet and testnet databases
    await deleteWalletFromDb(walletName, 'bitcoincash');
    await deleteWalletFromDb(walletName, 'bchtest');
    // Refresh the available wallets list
    await refreshAvailableWallets();
  }

  async function initializeWalletConnect() {
    try {
      const walletconnectStore = useWalletconnectStore(_wallet as Ref<Wallet>, changeNetwork)
      await walletconnectStore.initweb3wallet();
      isWcInitialized.value = true;

      // Setup network change callback to disconnect all sessions.
      networkChangeCallbacks.push(async () => {
        const sessions = walletconnectStore.web3wallet?.getActiveSessions();
        if(!sessions) return

        for (const session of Object.values(sessions)) {
          await walletconnectStore.web3wallet?.disconnectSession({
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
      const cashconnectWallet = useCashconnectStore(_wallet as Ref<Wallet>);

      // Start the wallet service.
      await cashconnectWallet.start();
      isCcInitialized.value = true;

      // Setup network change callback to disconnect all sessions.
      // NOTE: This must be wrapped, otherwise we don't have the appropriate context.
      networkChangeCallbacks.push(async () => {
        await cashconnectWallet.cashConnectWallet.disconnectAllSessions();
      });

      // Monitor the wallet for balance changes.
      // TODO: investigate if we should define the return CancelFn as 'cancelWatchBchtxsCashConnect'
      // Then we can call this on network changes, however we would need to re-create the watch for the new network
      void wallet.value.watchBalance(() => {
        // Convert the network into WC format,
        const chainIdFormatted = wallet.value.network === NetworkType.Mainnet ? 'bch:bitcoincash' : 'bch:bchtest';

        // Invoke wallet state has changed so that CashConnect can retrieve fresh UTXOs (and token balances).
        // fire-and-forget promise
        void cashconnectWallet.cashConnectWallet.walletStateHasChanged(chainIdFormatted);
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
    // Uses the walletUtxos to create a tokenList
    if(!walletUtxos.value) return // should never happen
    const newTokenList = tokenListFromUtxos(walletUtxos.value);
    // sort tokenList with featuredTokens first
    sortTokenList(newTokenList);
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
    const registries = await importBcmrRegistries(tokenList, fetchNftInfo, bcmrIndexer.value, bcmrRegistries.value);
    bcmrRegistries.value = registries
  }

  async function fetchTokenInfo(categoryId: string) {
    const res = await cachedFetch(`${bcmrIndexer.value}/tokens/${categoryId}/`);
    if (!res.ok) throw new Error(`Failed to fetch token info: ${res.status}`);
    const jsonResponse = await res.json()
    // validate the response to match expected schema
    const parseResult = BcmrIndexerResponseSchema.safeParse(jsonResponse);
    if (!parseResult.success) {
      console.error(`BCMR indexer response validation error for URL ${res.url}: ${parseResult.error.message}`);
      const errorMessage = 'BCMR indexer response validation error';
      throw new Error(errorMessage)
    }
    const bcmrIndexerResult = parseResult.data;
    // check for error in bcmrIndexerResult
    if ('error' in bcmrIndexerResult) {
      throw new Error(`Indexer error: ${bcmrIndexerResult.error}`);
    }
    return bcmrIndexerResult;
  }
  

  function hasPreGenesis(){
    const preGenesisUtxo = walletUtxos.value?.find(utxo => !utxo.token && utxo.vout === 0);
    plannedTokenId.value = preGenesisUtxo?.txid ?? undefined;
  }

  async function fetchAuthUtxos() {
    if(!tokenList.value?.length || !walletUtxos.value) return
    const tokenUtxos = getTokenUtxos(walletUtxos.value);
    const newTokenList = await updateTokenListWithAuthUtxos(tokenList.value, settingsStore.chaingraph, tokenUtxos)
    tokenList.value = newTokenList;
  }

  function toggleFavorite(tokenId: string) {
    if(!tokenList.value) return // should never happen
    // Remove token from featuredTokens if it's already there, otherwise add it
    const newFeaturedTokens = settingsStore.featuredTokens.includes(tokenId) ?
      settingsStore.featuredTokens.filter(id => id !== tokenId) :
      [...settingsStore.featuredTokens, tokenId];
    // save the new featuredTokens to local storage
    localStorage.setItem("featuredTokens", JSON.stringify(newFeaturedTokens));
    settingsStore.featuredTokens = newFeaturedTokens;
    // actually change the UI list by updating the state
    sortTokenList(tokenList.value);
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
      // Extract the version tag (e.g. 'v0.2.4')
      latestGithubRelease.value = releaseData.tag_name;
      console.log(latestGithubRelease.value)
    } catch (error) {
      console.error('Error fetching latest GitHub release:', error);
    }
  }

  return {
    activeWalletName,
    availableWallets,
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
    switchWallet,
    refreshAvailableWallets,
    deleteWallet,
    fetchTokenInfo,
    hasPreGenesis,
    fetchAuthUtxos,
    importRegistries,
    toggleFavorite,
    tokenIconUrl
  }
})
