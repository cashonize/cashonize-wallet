import { defineStore } from "pinia"
import { ref, reactive, computed, type Ref } from 'vue'
import {
  Wallet,
  TestNetWallet,
  HDWallet,
  TestNetHDWallet,
  BaseWallet,
  Config,
  Connection,
  convert,
  type Utxo,
  type ElectrumNetworkProvider,
  type CancelFn,
  NetworkType
} from "mainnet-js"
import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"
import EncryptedIndexedDBProvider from "src/security/EncryptedIndexedDBProvider"
import {
  CurrencySymbols,
  type BcmrTokenMetadata,
  type TokenList,
  type WalletHistoryReturnType,
  type WalletType
} from "../interfaces/interfaces"
import {
  getBalanceFromUtxos,
  getTokenUtxos,
  runAsyncVoid
} from "src/utils/utils"
import {
  fetchTokenMetadata as fetchTokenMetadataFromIndexer,
  fetchNftMetadata as fetchNftMetadataFromIndexer,
  tokenListFromUtxos,
  updateTokenListWithAuthUtxos,
} from "./storeUtils"
import type { ParseResult } from "src/parsing/nftParsing"
import { parseNft, type NftParseInfo } from "src/parsing/nftParsing"
import { utxoToLibauthOutput } from "src/parsing/utxoConverter"
import { convertElectrumTokenData } from "src/utils/utils"
import { Notify } from "quasar";
import { useSettingsStore } from './settingsStore'
import { useWalletconnectStore } from "./walletconnectStore"
import { useCashconnectStore } from "./cashconnectStore"
import { displayAndLogError } from "src/utils/errorHandling"
import { cachedFetch } from "src/utils/cacheUtils"
import { BcmrIndexerResponseSchema } from "src/utils/zodValidation"
import { deleteWalletFromDb, getAllWalletsWithNetworkInfo, getWalletTypeFromDb, type WalletInfo } from "src/utils/dbUtils"
import { fetchCauldronPrices, type CauldronPriceData } from "src/utils/cauldronApi"
import { defaultWalletName } from './constants';
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global
const settingsStore = useSettingsStore()

// set mainnet-js config
Config.EnforceCashTokenReceiptAddresses = true;
Config.UseIndexedDBCache = true;
BaseWallet.StorageProvider = process.env.MODE === 'electron' ? EncryptedIndexedDBProvider : IndexedDBProvider;

const defaultBcmrIndexer = 'https://bcmr.paytaca.com/api';
const defaultBcmrIndexerChipnet = 'https://bcmr-chipnet.paytaca.com/api';

const isDesktop = (process.env.MODE == "electron");

export const useStore = defineStore('store', () => {
  const displayView = ref(undefined as (number | undefined));
  const viewStack = reactive<number[]>([]);
  // Multi-wallet state
  const activeWalletName = ref(localStorage.getItem('activeWalletName') ?? defaultWalletName);
  const availableWallets = ref([] as WalletInfo[]);
  // Wallet State
  // _wallet is the actual reactive wallet object and is null until the wallet is set
  // so _wallet is used for mutating properties of the wallet, like changing the provider
  const _wallet = ref(null as (WalletType | null));
  const balance = ref(undefined as (bigint | undefined));
  const maxAmountToSend = ref(undefined as (bigint | undefined));
  const walletUtxos = ref(undefined as (Utxo[] | undefined));
  const walletHistory = ref(undefined as (WalletHistoryReturnType | undefined));
  const tokenList = ref(null as (TokenList | null))
  const plannedTokenId = ref(undefined as (undefined | string));
  const currentBlockHeight = ref(undefined as (number | undefined));
  const bcmrRegistries = ref(undefined as (Record<string, BcmrTokenMetadata> | undefined));
  const cauldronPrices = ref<Record<string, CauldronPriceData> | null>(null);
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
  const bcmrIndexer = computed(() => network.value == 'mainnet' ? defaultBcmrIndexer : defaultBcmrIndexerChipnet)

  // Filtered token list based on display filter setting
  const filteredTokenList = computed(() => {
    if (!tokenList.value) return null;

    const filter = settingsStore.tokenDisplayFilter;

    if (filter === 'all') {
      return tokenList.value;
    }
    if (filter === 'default') {
      return tokenList.value.filter(t => !settingsStore.hiddenTokens.includes(t.category));
    }
    if (filter === 'favoritesOnly') {
      return tokenList.value.filter(t => settingsStore.featuredTokens.includes(t.category));
    }
    if (filter === 'hiddenOnly') {
      return tokenList.value.filter(t => settingsStore.hiddenTokens.includes(t.category));
    }
    return tokenList.value;
  })

  let cancelWatchBchtxs: undefined | CancelFn;
  let cancelWatchTokenTxs: undefined | CancelFn;
  let cancelWatchBlocks: undefined | CancelFn;
  let cancelWatchBchBalanceCashConnect: undefined | CancelFn;

  async function cancelWalletSubscriptions() {
    const cancelSubscriptionCallbacks = [
      cancelWatchBchtxs,
      cancelWatchTokenTxs,
      cancelWatchBlocks,
      cancelWatchBchBalanceCashConnect,
    ];
    const activeCancels = cancelSubscriptionCallbacks.filter((cancelFn): cancelFn is CancelFn => cancelFn !== undefined);

    cancelWatchBchtxs = undefined;
    cancelWatchTokenTxs = undefined;
    cancelWatchBlocks = undefined;
    cancelWatchBchBalanceCashConnect = undefined;

    await Promise.all(activeCancels.map((cancelFn) =>
      cancelFn().catch(() => {})
    ));
  }

  // Create a callback that triggers when we switch networks.
  let networkChangeCallbacks: Array<() => Promise<void>> = [];

  function changeView(newView: number) {
    // Skip if already on this view
    if (viewStack.length > 0 && viewStack[viewStack.length - 1] === newView) return;

    // Remove newView from its current position (move-to-front)
    const existingIndex = viewStack.indexOf(newView);
    if (existingIndex !== -1) {
      viewStack.splice(existingIndex, 1);
    }

    // Push browser history entry (skip for the very first view)
    if (viewStack.length > 0) {
      history.pushState(null, '');
    }

    viewStack.push(newView);
    displayView.value = newView;
  }

  // Note: browser forward button won't work correctly with this implementation.
  // popstate can't distinguish back from forward, so forward acts as another back. 
  addEventListener('popstate', () => {
    if (viewStack.length <= 1) return;
    viewStack.pop();
    const previousView = viewStack[viewStack.length - 1];
    if (previousView !== undefined) {
      displayView.value = previousView;
    }
  });

  const canGoBack = computed(() => viewStack.length > 1);

  // setWallet is a simple wrapper "set" function for the internal _wallet in the store.
  // It adds the configured electrum network provider on the wallet depending on the network.
  // Call initializeWallet() afterwards to actually connect to the electrum client and to fetch initial data.
  function setWallet(newWallet: WalletType){
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
    _wallet.value?.stop().catch(() => {});
    _wallet.value = newWallet;
  }

  async function initializeWallet() {
    let failedToConnectElectrum = false
    if(!_wallet.value) throw new Error("No Wallet set in global store")

    walletInitialized.value = false;
    await cancelWalletSubscriptions();

    // Verify wallet type metadata matches the actual wallet class
    // Use 'walletCache' property to detect HD wallets (exists on HDWallet, not on single-address Wallet)
    const metadataType = settingsStore.getWalletType(activeWalletName.value);
    const isActuallyHD = 'walletCache' in _wallet.value;
    if (metadataType === 'hd' && !isActuallyHD) {
      throw new Error(`Wallet type mismatch: metadata says 'hd' but wallet is single-address. This may indicate corrupted settings.`);
    }
    if (metadataType === 'single' && isActuallyHD) {
      throw new Error(`Wallet type mismatch: metadata says 'single' but wallet is HD. This may indicate corrupted settings.`);
    }

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
          displayAndLogError(new Error(t('store.errors.unableToConnectElectrum', { server: electrumServer })))
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
      // to avoid duplicate getUtxos() calls
      console.time('fetch wallet utxos');
      const walletAddressUtxos = await wallet.value.getUtxos()
      console.timeEnd('fetch wallet utxos');
      const balanceSats = getBalanceFromUtxos(walletAddressUtxos)
      // Fetch fiat balance and max amount to send in parallel
      // 'getMaxAmountToSend' combines multiple fetches (blockheight, relayfee, price) so is a bit slower
      console.time('fetch fiat balance & max amount to send');
      const promiseMaxAmountToSend = wallet.value.getMaxAmountToSend({
        options: { utxoIds: walletAddressUtxos }
      });
      const balancePromises = [promiseMaxAmountToSend];
      const [resultMaxAmountToSend] = await Promise.all(balancePromises);
      console.timeEnd('fetch fiat balance & max amount to send');
      // set values simulatenously with tokenList so the UI elements load together
      balance.value = balanceSats
      walletUtxos.value = walletAddressUtxos
      maxAmountToSend.value = resultMaxAmountToSend
      updateTokenList()
      console.time('set up wallet subscriptions');
      await setUpWalletSubscriptions();
      console.timeEnd('set up wallet subscriptions');
      if(!tokenList.value) return // should never happen
      // fire-and-forget getLatestGithubRelease promise for desktop platform
      if(isDesktop) void getLatestGithubRelease()
      console.time('fetch token metadata');
      await fetchTokenMetadata(tokenList.value, false);
      console.timeEnd('fetch token metadata');
      // fetch Cauldron prices as fire-and-forget (non-critical)
      void fetchCauldronPricesForTokens();
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
    // Dedupe txids to avoid duplicate token processing during reconnect/resubscribe bursts.
    const seenTokenTxIds = new Set<string>();

    cancelWatchBchtxs = await wallet.value.watchBalance(
      // use runAsyncVoid to wrap an async function as a synchronous callback
      // this means the promise is fire-and-forget
      (newBalance) => runAsyncVoid(async () => {
        // Compute oldBalance including bch on token utxos
        // to match way newBalance is calculated in watchBalance
        const oldBalance = walletUtxos.value?.reduce((acc, utxo) => acc + utxo.satoshis, BigInt(0));
        if(oldBalance && newBalance && walletInitialized.value){
          if(oldBalance < newBalance){
            const balanceDifferenceSats = newBalance - oldBalance;
            let amountInUnit = Number(balanceDifferenceSats) / 100_000_000;
            let unitString = network.value == 'mainnet' ? 'BCH' : 'tBCH';
            let maxFractionDigits = 8;
            if(settingsStore.bchUnit === 'sat'){
              amountInUnit = Number(balanceDifferenceSats);
              unitString = network.value == 'mainnet' ? 'sats' : 'tsats';
              maxFractionDigits = 0;
            }
            const currencyValue = await convert(amountInUnit, settingsStore.bchUnit, settingsStore.currency);
            const formattedAmount = amountInUnit.toLocaleString("en-US", { maximumFractionDigits: maxFractionDigits })
            const formattedCurrencyValue = currencyValue.toLocaleString("en-US", { maximumFractionDigits: 2 });
            const formattedFiat = formattedCurrencyValue + CurrencySymbols[settingsStore.currency]
            Notify.create({
              type: 'positive',
              message: t('store.notifications.receivedBch', {
                amount: formattedAmount,
                unit: unitString,
                fiatValue: formattedFiat
              })
            })
          }
          // update state (but not on the initial trigger when creating the subscription)
          const walletAddressUtxos = await wallet.value.getUtxos();
          const maxAmount = await wallet.value.getMaxAmountToSend({ options:{
            utxoIds: walletAddressUtxos
          }});
          // update balance with the amount on bch-only utxos
          const balanceSats = getBalanceFromUtxos(walletAddressUtxos)
          balance.value = balanceSats;
          walletUtxos.value = walletAddressUtxos;
          maxAmountToSend.value = maxAmount;
          // update wallet history as fire-and-forget promise
          void updateWalletHistory()
        }
      })
    );
    cancelWatchTokenTxs = await wallet.value.watchTokenTransactions(
      // use runAsyncVoid to wrap an async function as a synchronous callback
      // this means the promise is fire-and-forget
      (tx) => runAsyncVoid(async () => {
        // Guard: the initial watchStatus invocation fires callbacks for all existing txs
        // before walletInitialized is set to true, so skip those
        if(!walletInitialized.value) return

        // Defensive dedupe for reconnect/re-subscribe bursts.
        if (seenTokenTxIds.has(tx.txid)) return;
        seenTokenTxIds.add(tx.txid);

        const receivedTokenOutputs = tx.vout.filter(voutElem =>
          voutElem.tokenData && voutElem.scriptPubKey.addresses?.[0] &&
          wallet.value.hasAddress(voutElem.scriptPubKey.addresses[0])
        );
        const previousTokenList = tokenList.value;
        const listNewTokens:TokenList = []
        // Fetch extended tx with loaded input values to check if any input belongs to this wallet
        const extendedTx = await wallet.value.provider.getRawTransactionObject(tx.txid, true);
        // User-sent txs produce token change outputs that trigger this subscription, skip notification for those
        const isUserInitiatedTx = extendedTx.vin.some(vinElem =>
          vinElem.scriptPubKey?.addresses?.[0] &&
          wallet.value.hasAddress(vinElem.scriptPubKey.addresses[0])
        );
        for(const tokenOutput of receivedTokenOutputs){
          const outputTokenData = tokenOutput.tokenData!;
          // Only notify for externally received tokens, not user-sent change outputs
          if(!isUserInitiatedTx){
            const tokenType = outputTokenData.nft ? "NFT" : "tokens"
            Notify.create({
              type: 'positive',
              message: t('store.notifications.receivedTokens', { tokenType })
            })
          }
          const category = outputTokenData.category;
          const isKnownCategory = previousTokenList?.some(elem => elem.category === category) ?? false;
          if (isKnownCategory) {
            // Skip fetching metadata if we already know this category for fungible tokens
            if (!outputTokenData.nft) continue;

            // Skip fetching metadata if we already know this category with this commitment for NFTs
            const commitment = outputTokenData.nft.commitment ?? "";
            const hasCommitmentMetadata = bcmrRegistries.value?.[category]?.nfts?.[commitment] !== undefined;
            if (hasCommitmentMetadata) continue;
          }

          const newTokenItem = convertElectrumTokenData(outputTokenData)
          if(newTokenItem) listNewTokens.push(newTokenItem)
        }
        // Dynamically fetch token metadata
        await fetchTokenMetadata(listNewTokens, true);
        // refetch utxos to update tokenList
        await updateWalletUtxos();
        // fetch Cauldron prices for new FTs
        void fetchCauldronPricesForTokens();
        // update wallet history as fire-and-forget promise
        void updateWalletHistory()
      })
    );
    cancelWatchBlocks = await wallet.value.watchBlocks(header => {
      currentBlockHeight.value = header.height;
    }, false);
  }

  function resetWalletState(){
    viewStack.length = 0;
    walletInitialized.value = false;
    // Execute each of our network changed callbacks.
    // In practice, we're using these for WC/CC to disconnect their sessions.
    // TODO: investigate if disconnecting session this way is properly working
    // Call disconnects as fire-and-forget promises
    networkChangeCallbacks.forEach((callback) => void callback());
    // clear the networkChangeCallbacks before initialising newWallet 
    networkChangeCallbacks = []

    // cancel active listeners
    void cancelWalletSubscriptions();
    // reset wallet to default state
    balance.value = undefined;
    maxAmountToSend.value = undefined;
    plannedTokenId.value = undefined;
    tokenList.value = null;
    bcmrRegistries.value = undefined;
    cauldronPrices.value = null;
    walletHistory.value = undefined;
  }

  async function getWalletClass(walletName: string, network: string) {
    // Ensure wallet type metadata exists, detect from IndexedDB if missing
    const metadata = settingsStore.getWalletMetadata(walletName);
    if (!metadata?.walletType) {
      const dbName = network === 'mainnet' ? 'bitcoincash' : 'bchtest';
      const detectedType = await getWalletTypeFromDb(walletName, dbName);
      settingsStore.setWalletType(walletName, detectedType);
    }

    const isHD = settingsStore.getWalletType(walletName) === 'hd';
    if (network === 'mainnet') return isHD ? HDWallet : Wallet;
    return isHD ? TestNetHDWallet : TestNetWallet;
  }

  async function changeNetwork(
    newNetwork: 'mainnet' | 'chipnet',
    awaitWalletInitialization: boolean = false
  ){
    resetWalletState()
    // set new wallet
    const walletClass = await getWalletClass(activeWalletName.value, newNetwork);
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

  interface SwitchWalletResult {
    success: true;
    networkChanged?: 'mainnet' | 'chipnet'; // Set if network was changed to accommodate wallet
  }

  async function switchWallet(walletName: string): Promise<SwitchWalletResult> {
    // Get the current network from localStorage (default to mainnet)
    const currentNetwork = (localStorage.getItem('network') ?? 'mainnet') as 'mainnet' | 'chipnet';

    // Check if wallet exists on current network (if we have wallet info available)
    const walletInfo = availableWallets.value.find(w => w.name === walletName);
    if (walletInfo) {
      const networkSelector = currentNetwork === 'mainnet' ? 'hasMainnet' : 'hasChipnet';
      const walletExistsOnCurrentNetwork = walletInfo[networkSelector];

      // If wallet doesn't exist on current network, switch to a network where it does
      if (!walletExistsOnCurrentNetwork) {
        const targetNetwork = walletInfo.hasMainnet ? 'mainnet' : 'chipnet';
        activeWalletName.value = walletName;
        localStorage.setItem('activeWalletName', walletName);
        // changeNetwork will reset state and initialize the wallet
        void changeNetwork(targetNetwork);
        return { success: true, networkChanged: targetNetwork };
      }
    }

    // Load wallet on current network
    const walletClass = await getWalletClass(walletName, currentNetwork);
    const newWallet = await walletClass.named(walletName);
    // Only update state after successful wallet load
    activeWalletName.value = walletName;
    localStorage.setItem('activeWalletName', walletName);
    resetWalletState();
    setWallet(newWallet);
    changeView(1);
    // fire-and-forget - don't await so UI is responsive
    void initializeWallet();
    return { success: true };
  }

  async function refreshAvailableWallets() {
    // Get wallet info from both mainnet and chipnet databases
    availableWallets.value = await getAllWalletsWithNetworkInfo();
  }

  async function deleteWallet(walletName: string) {
    if (walletName === activeWalletName.value) {
      throw new Error(t('store.errors.cannotDeleteActiveWallet'));
    }
    // Delete from both mainnet and testnet databases
    await deleteWalletFromDb(walletName, 'bitcoincash');
    await deleteWalletFromDb(walletName, 'bchtest');
    // Refresh the available wallets list
    await refreshAvailableWallets();
  }

  async function initializeWalletConnect() {
    try {
      const walletconnectStore = useWalletconnectStore(_wallet as Ref<WalletType>)
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
        message: t('store.errors.errorInitializingWalletConnect'),
        icon: 'warning',
        color: "red"
      });
    }
  }

  async function initializeCashConnect() {
    // CashConnect requires a single-address wallet with a private key
    const walletPrivateKey = (_wallet.value as Wallet | null)?.privateKey;
    if (settingsStore.getWalletType(activeWalletName.value) === 'hd' || !walletPrivateKey) {
      isCcInitialized.value = true;
      return;
    }
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

      // Monitor the wallet for balance changes and notify CashConnect to refresh wallet state.
      cancelWatchBchBalanceCashConnect = await wallet.value.watchBalance(() => {
        // Convert the network into WC format,
        const chainIdFormatted = wallet.value.network === NetworkType.Mainnet ? 'bch:bitcoincash' : 'bch:bchtest';

        // Invoke wallet state has changed so that CashConnect can retrieve fresh UTXOs (and token balances).
        // fire-and-forget promise
        void cashconnectWallet.cashConnectWallet.walletStateHasChanged(chainIdFormatted);
      });
    } catch (error) {
      console.error("Error initializing CashConnect:", error);
      Notify.create({
        message: t('store.errors.errorInitializingCashConnect'),
        icon: 'warning',
        color: "red"
      });
    }
  }

  async function updateWalletUtxos() {
    try {
      walletUtxos.value = await wallet.value.getUtxos();
      updateTokenList()
    } catch(error) {
      const errorMessage = typeof error == 'string' ? error : t('store.errors.errorFetchingUtxos');
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
      const errorMessage = typeof error == 'string' ? error : t('store.errors.errorFetchingHistory');
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
      const featuredTokenItem = unsortedTokenList.find(token => token.category === featuredToken);
      if(featuredTokenItem) featuredTokenList.push(featuredTokenItem)
    }
    const otherTokenList = unsortedTokenList.filter(token => !settingsStore.featuredTokens.includes(token.category));

    tokenList.value = [...featuredTokenList, ...otherTokenList];
  }

  // Fetch token metadata from BCMR indexer
  async function fetchTokenMetadata(tokenList: TokenList, fetchNftInfo: boolean) {
    const registries = await fetchTokenMetadataFromIndexer(tokenList, fetchNftInfo, bcmrIndexer.value, bcmrRegistries.value);
    bcmrRegistries.value = registries
  }

  // Fetch Cauldron prices for fungible tokens
  async function fetchCauldronPricesForTokens() {
    if (!settingsStore.showCauldronFTValue) return;
    if (network.value !== 'mainnet') return;

    const fungibleTokens = tokenList.value?.filter(token => 'amount' in token)
    if (fungibleTokens?.length === 0) return;

    const ftTokenIds = fungibleTokens?.map(token => token.category) ?? [];

    // Warm the exchange rate cache first, then fetch prices
    await convert(1, 'bch', settingsStore.currency);
    cauldronPrices.value = await fetchCauldronPrices(ftTokenIds);
  }

  async function fetchTokenInfo(categoryId: string) {
    const res = await cachedFetch(`${bcmrIndexer.value}/tokens/${categoryId}/`);
    if (!res.ok) throw new Error(`Failed to fetch token info: ${res.status}`);
    const jsonResponse = await res.json()
    // validate the response to match expected schema
    const parseResult = BcmrIndexerResponseSchema.safeParse(jsonResponse);
    if (!parseResult.success) {
      console.error(`BCMR indexer response validation error for URL ${res.url}: ${parseResult.error.message}`);
      throw new Error(t('store.errors.bcmrIndexerValidationError'))
    }
    const bcmrIndexerResult = parseResult.data;
    // check for error in bcmrIndexerResult
    if ('error' in bcmrIndexerResult) {
      throw new Error(`Indexer error: ${bcmrIndexerResult.error}`);
    }
    return bcmrIndexerResult;
  }

  // Fetch NFT metadata for a specific category and commitment, updating bcmrRegistries
  async function fetchNftMetadata(category: string, commitment: string) {
    const registries = await fetchNftMetadataFromIndexer(category, commitment, bcmrIndexer.value, bcmrRegistries.value);
    bcmrRegistries.value = registries;
  }
  

  function parseNftCommitment(
    categoryId: string,
    utxo: Utxo
  ): ParseResult | undefined {
    const metadata = bcmrRegistries.value?.[categoryId];
    if (!metadata?.token.nfts?.parse || metadata.nft_type !== 'parsable') return undefined;

    const parse = metadata.token.nfts.parse;
    if (!('bytecode' in parse)) return undefined;

    const parseInfo: NftParseInfo = {
      bytecode: parse.bytecode,
      types: parse.types,
      fields: metadata.token.nfts.fields,
    };

    const libauthOutput = utxoToLibauthOutput(utxo);
    return parseNft(libauthOutput, parseInfo);
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
    // If favoriting, also unhide the token (mutual exclusivity)
    if (newFeaturedTokens.includes(tokenId) && settingsStore.hiddenTokens.includes(tokenId)) {
      const newHiddenTokens = settingsStore.hiddenTokens.filter(id => id !== tokenId);
      localStorage.setItem("hiddenTokens", JSON.stringify(newHiddenTokens));
      settingsStore.hiddenTokens = newHiddenTokens;
    }
    // actually change the UI list by updating the state
    sortTokenList(tokenList.value);
  }

  function toggleHidden(tokenId: string) {
    // Remove token from hiddenTokens if it's already there, otherwise add it
    const newHiddenTokens = settingsStore.hiddenTokens.includes(tokenId) ?
      settingsStore.hiddenTokens.filter(id => id !== tokenId) :
      [...settingsStore.hiddenTokens, tokenId];
    // save the new hiddenTokens to local storage
    localStorage.setItem("hiddenTokens", JSON.stringify(newHiddenTokens));
    settingsStore.hiddenTokens = newHiddenTokens;
    // If hiding, also unfavorite the token (mutual exclusivity)
    if (newHiddenTokens.includes(tokenId) && settingsStore.featuredTokens.includes(tokenId)) {
      const newFeaturedTokens = settingsStore.featuredTokens.filter(id => id !== tokenId);
      localStorage.setItem("featuredTokens", JSON.stringify(newFeaturedTokens));
      settingsStore.featuredTokens = newFeaturedTokens;
      // Re-sort token list since featured tokens changed
      if (tokenList.value) {
        sortTokenList(tokenList.value);
      }
    }
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
    filteredTokenList,
    walletHistory,
    plannedTokenId,
    isWcAndCcInitialized,
    latestGithubRelease,
    network,
    explorerUrl,
    bcmrRegistries,
    cauldronPrices,
    currentBlockHeight,
    canGoBack,
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
    fetchNftMetadata,
    parseNftCommitment,
    hasPreGenesis,
    fetchAuthUtxos,
    fetchTokenMetadata,
    fetchCauldronPricesForTokens,
    toggleFavorite,
    toggleHidden,
    tokenIconUrl,
    getWalletClass
  }
})
