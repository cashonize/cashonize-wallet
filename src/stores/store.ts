import { defineStore } from "pinia"
import { ref, shallowRef, reactive, computed, watch } from 'vue'
import {
  HDWallet,
  TestNetHDWallet,
  BaseWallet,
  GAP_SIZE,
  Config,
  Connection,
  DefaultProvider,
  disconnectProviders,
  convert,
  ExchangeRate,
  type Utxo,
  type ElectrumNetworkProvider,
  type CancelFn,
  type SendRequestOptionsI,
  type SendRequestType,
  type TokenGenesisRequest,
  type TokenMintRequest,
  type TokenBurnRequest,
  NetworkType
} from "mainnet-js"
import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"
import {
  CurrencySymbols,
  type BcmrTokenMetadata,
  type TokenList,
  type WalletHistoryReturnType,
  type WalletType
} from "../interfaces/interfaces"
import {
  electrumWssUrl,
  formatBchAmount,
  getBalanceFromUtxos,
  loadWalletFromId,
  runAsyncVoid,
  walletTypeFromWalletId
} from "src/utils/utils"
import {
  fetchTokenMetadata as fetchTokenMetadataFromIndexer,
  fetchNftMetadata as fetchNftMetadataFromIndexer,
  tokenListFromUtxos,
  parseNftCommitment as parseNftCommitmentUtil,
} from "./storeUtils"
import { hexToBin, lockingBytecodeToCashAddress } from "@bitauth/libauth"
import {
  checkReservedInputs,
  type Bytes,
  type SignedInput,
  type SignedOutput,
} from "src/utils/dapp/reservedInputs"
import { convertElectrumTokenData } from "src/utils/utils"
import { Notify } from "quasar";
import { useSettingsStore } from './settingsStore'
import { useWalletconnectStore } from "./walletconnectStore"
import { useCashconnectStore } from "./cashconnectStore"
import { useWizardconnectStore } from "./wizardconnectStore"
import { displayAndLogError } from "src/utils/errorHandling"
import { cachedFetch } from "src/utils/cacheUtils"
import { BcmrIndexerResponseSchema } from "src/utils/zodValidation"
import { pruneHdWalletKeyCache, deleteWalletFromDb, getAllWalletsWithNetworkInfo, getNamedWalletIdFromDb, type WalletInfo } from "src/utils/wallet/dbUtils"
import { fetchCauldronPrices, type CauldronPriceData } from "src/utils/defi/cauldronApi"
import {
  fetchCauldronPools,
  cauldronChainPublicKeyHashes,
  publicKeyHashFromAddress,
  type CauldronPool
} from "src/utils/defi/cauldronPools"
import { fetchBadgerLocks, type BadgerLock } from "src/utils/defi/badgersStake"
import { listingsFromSpentOutputs, type TapswapListing } from "src/utils/defi/tapswapListings"
import { hodlContractsFromSpentOutputs, fetchHodlContractStates, type HodlContract } from "src/utils/defi/hodlContracts"
import { ChaingraphRequestError, querySpentOutputs, type ChaingraphSpentOutput } from "src/queryChainGraph"
import { loadTxNotes, saveTxNote, removeTxNotes } from "src/utils/history/txNotes"
import {
  loadAddressMarks,
  saveAddressMark,
  deleteAddressMark,
  loadAddressLabels,
  saveAddressLabel,
  removeAddressManagementData,
  deriveFreshAddressIndex
} from "src/utils/wallet/addressManagement"
import {
  loadReservedUtxos,
  saveReservedUtxo,
  saveReservedOutpoint,
  deleteReservedUtxo,
  removeReservedUtxos,
  spendableFromUtxos,
  reservedFromUtxos,
  outpointOf,
  type Outpoint,
  type ReservedUtxos,
  type ReservationReason
} from "src/utils/wallet/reservedUtxos"
import {
  loadUtxoLabels,
  saveUtxoLabel,
  removeUtxoLabels,
  type UtxoLabels,
} from "src/utils/wallet/utxoLabels"
import { removePledges } from "src/utils/tools/flipstarterPledges"
import {
  loadIdentityCategories,
  saveIdentityCategory,
  deleteIdentityCategory,
  removeIdentityCategories,
  loadAuthKeyCategories,
  saveAuthKeyCategory,
  deleteAuthKeyCategory,
  loadDismissedIdentities,
  saveDismissedIdentity,
  undismissIdentity,
  loadUnseenIdentities,
  saveUnseenIdentities,
  clearUnseenIdentities,
  loadUnnamedAuthheads,
  saveUnnamedAuthhead,
  deleteUnnamedAuthhead,
  loadUnnameableAuthheads,
  saveUnnameableAuthhead,
  resolveIdentities,
  describeChainLinks,
  checkPublicationUri,
  identityKeyCoin,
  type IdentityState,
  type IdentityScanSummary,
  type DescribedLink,
  type GuardedIdentity,
  type PublicationUriCheck
} from "src/utils/tools/authchainIdentity"
import {
  authGuardAddresses,
  guardContentsFromUtxos,
  isAuthKeyCandidate,
} from "src/utils/tools/authGuard"
import { queryAuthHeadWithOutputs, queryAuthchainLinks } from "src/queryChainGraph"
import { detectIdentities, nameChainByWalkingBack, publicationTxids } from "src/utils/tools/identityDetection"
import { defaultWalletName } from './constants';
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global
const settingsStore = useSettingsStore()

const isDesktop = import.meta.env.QUASAR_ELECTRON_MODE;
const EXCHANGE_RATE_REFETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CAULDRON_REFETCH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

//-----------------------------------------------------------------------------
// mainnet-js configuration
//-----------------------------------------------------------------------------
// All of it has to be applied before the first wallet is constructed. Wallet
// creation reads several of these at construction time, and an HD wallet starts
// address discovery straight away, so anything set later arrives too late.

Config.EnforceCashTokenReceiptAddresses = true;
// Never set Config.UseLocalStorageCache instead: its clear() is a bare localStorage.clear(),
// which would take every app setting, transaction note and address label with it
Config.UseIndexedDBCache = true;
BaseWallet.StorageProvider = IndexedDBProvider;

// Point mainnet-js's default electrum servers at the user's selected servers.
// Wallet construction (WalletClass.named) — and eager HD address discovery in particular — builds its
// network provider from these defaults BEFORE the app assigns one via setWallet. Without this, mainnet-js
// falls back to its hardcoded default server (blackie.c3-soft.com), leaking the wallet's address
// subscriptions to a server the user never selected. Kept in sync with settings via a watch (see below).
function setDefaultElectrumServers() {
  DefaultProvider.servers.mainnet = [electrumWssUrl(settingsStore.electrumServerMainnet)];
  DefaultProvider.servers.testnet = [electrumWssUrl(settingsStore.electrumServerChipnet)];
}
setDefaultElectrumServers();

// Pin the fee rate mainnet-js builds transactions at, instead of letting it ask the electrum
// server: it reads these globals before calling blockchain.relayfee and skips the call. A
// server can advertise a fee far below what the rest of the network relays, leaving the wallet
// building transactions no peer will pass on. BCH per kB, so 0.00001 is 1 sat/byte.
Object.assign(globalThis, { BCH_RELAY_FEE: 0.00001, tBCH_RELAY_FEE: 0.00001 });

// Config.DefaultCurrency is deliberately not set: mainnet-js reads it as it loads, before any
// app code has run, to warm an exchange rate cache. Assigning it afterwards is always too late,
// so currency-aware calls pass settingsStore.currency explicitly instead.

export const useStore = defineStore('store', () => {
  const displayView = ref(undefined as (number | undefined));
  const viewStack = reactive<number[]>([]);
  // Multi-wallet state
  const activeWalletName = ref(localStorage.getItem('activeWalletName') ?? defaultWalletName);
  const availableWallets = ref([] as WalletInfo[]);
  // Wallet State
  // _wallet holds the wallet object and is null until one is set.
  // The wallet's internals belong to mainnet-js: the library owns the key cache and the address
  // histories and mutates them behind its own references, including from callbacks holding the
  // wallet from before it reached this store. Vue cannot track that, so only swapping in
  // another wallet is reactive, nothing inside it is.
  const _wallet = shallowRef(null as (WalletType | null));
  const balance = ref(undefined as (bigint | undefined));
  const maxAmountToSend = ref(undefined as (bigint | undefined));
  const walletUtxos = ref(undefined as (Utxo[] | undefined));
  const walletHistory = ref(undefined as (WalletHistoryReturnType | undefined));
  const isHistoryPartial = ref(false);
  // Private notes on the active wallet's transactions, keyed by txid (see utils/txNotes.ts)
  const txNotes = ref({} as Record<string, string>);
  // Receive addresses the user marked as used and address labels, keyed by cashaddr
  // (see utils/addressManagement.ts)
  const addressMarks = ref([] as string[]);
  const addressLabels = ref({} as Record<string, string>);
  // Coins held back from coin selection, keyed by outpoint (see utils/wallet/reservedUtxos.ts)
  const reservedUtxos = ref({} as ReservedUtxos);
  // Private labels on the wallet's coins, keyed by outpoint (see utils/wallet/utxoLabels.ts)
  const utxoLabels = ref({} as UtxoLabels);
  // Token categories whose authhead this wallet keeps custody of, and where those authheads sit
  // now. Only the categories persist, the resolved state is rebuilt from Chaingraph every time
  // (see utils/tools/authchainIdentity.ts).
  const identityCategories = ref([] as string[]);
  // AuthKey categories this wallet watches without holding the key
  const watchedAuthKeys = ref([] as string[]);
  // Categories the user took off the list, which the automatic detection must not put back
  const dismissedIdentities = ref([] as string[]);
  // Listed by the wallet itself and not yet seen: what the marker on the wallet tools entry is
  // for, and what marks the cards as found automatically on the visit that clears it
  const unseenIdentities = ref([] as string[]);
  // Authheads held here that the detection could not name. Protected all the same: naming is a
  // convenience, an unspendable coin is the point.
  const unnamedAuthheads = ref([] as string[]);
  // Authheads a completed walk could not name, so an unchanged one is not walked again on every
  // wallet open. Keyed by the authhead's txid, which makes it self-invalidating: the moment the
  // authhead moves it is a different txid and earns a fresh walk.
  const unnameableAuthheads = ref([] as string[]);
  // The wallet's own transactions that carried a metadata publication, read off the same walk, so
  // the history can tell a metadata update from the wallet's other identity operations
  const identityPublicationTxids = ref([] as string[]);
  const identities = ref(undefined as (IdentityState[] | undefined));
  // What each listed identity's published registry locations actually serve, keyed by category.
  // Kept beside the identities rather than on them: resolution reads the chain, this reads the
  // hosting, and one can be present without the other.
  const publicationChecks = ref({} as Record<string, PublicationUriCheck[]>);
  const publicationChecksRunning = ref(false);
  // Identity outputs a covenant holds for this wallet, keyed by category, rebuilt on every resolve
  // like everything else about an authhead. Never stored: a key's guard is derived from it.
  const guardedIdentities = ref({} as Record<string, GuardedIdentity>);
  // Guarded outputs found but not nameable without a lookup this version does not have, per key
  // category, so a key that guards only those does not read as guarding nothing.
  const unidentifiedGuarded = ref({} as Record<string, number>);
  // Candidates whose covenant turned out to hold nothing, so they are ordinary NFTs after all.
  // Session-local on purpose: a stored answer would be a stored derivation, and asking again after
  // a restart costs one listing.
  let settledNonKeys: string[] = [];
  // One resolve at a time: a pass writes the identities list and the 'auth' reservations derived
  // from it whole, so two overlapping passes would undo each other's result
  const identitiesResolving = ref(false);
  const tokenList = ref(null as (TokenList | null))
  // Category a token payment request asks for, set when the user chooses to open it from
  // the wallet page. The token list narrows itself to it and clears it again.
  const pendingTokenSearch = ref(undefined as (undefined | string));
  const currentBlockHeight = ref(undefined as (number | undefined));
  const bcmrRegistries = ref(undefined as (Record<string, BcmrTokenMetadata> | undefined));
  const cauldronPrices = ref<Record<string, CauldronPriceData> | null>(null);
  // Cauldron liquidity pools owned by the wallet, null until the portfolio view looks them up
  const cauldronPools = ref<CauldronPool[] | null>(null);
  // BCH locked in the Badgers.cash contract, null until the portfolio view looks it up
  const badgerLocks = ref<BadgerLock[] | null>(null);
  // Assets listed for sale on TapSwap, null until the portfolio view looks them up
  const tapswapListings = ref<TapswapListing[] | null>(null);
  // Metadata of the listed assets. They are not held by the wallet, so like the dapp dialogs'
  // unverified metadata this lives in its own object rather than in bcmrRegistries.
  const tapswapRegistries = ref<Record<string, BcmrTokenMetadata>>({});
  // BCH locked in hodl contracts, null until the portfolio view looks it up
  const hodlContracts = ref<HodlContract[] | null>(null);
  // Why the last TapSwap and hodl lookup failed, shown inline in the portfolio view
  const announcedAssetsError = ref<string | undefined>(undefined);
  const exchangeRate = ref<number | undefined>(undefined);
  let exchangeRateInterval: ReturnType<typeof setInterval> | undefined;
  let cauldronPriceInterval: ReturnType<typeof setInterval> | undefined;
  // "InitDone" means the init attempt finished (success or failure), not that it succeeded.
  // Callers gating on these should proceed either way; pairing a failed protocol errors naturally.
  const isWcInitDone = ref(false as boolean)
  const isCcInitDone = ref(false as boolean)
  const isWizInitDone = ref(false as boolean)
  const walletInitialized = ref(false as boolean)
  // Set when wallet initialization aborts (electrum connection failure or a thrown error),
  // so views can show an error state instead of a loading state that never resolves
  const walletInitFailed = ref(false as boolean)
  const latestGithubRelease = ref(undefined as undefined | string);

  // Computed properties
  const network = computed(() => wallet.value.network == NetworkType.Mainnet ? "mainnet" : "chipnet")
  const explorerUrl = computed(() => network.value == "mainnet" ? settingsStore.explorerMainnet : settingsStore.explorerChipnet);

  // Access to the wallet without a null check at every call site: throws rather than hand out
  // null. Read-only, so replacing the wallet goes through _wallet.
  const wallet = computed(() => {
    if (!_wallet.value) throw new Error('No wallet set in global store');
    return _wallet.value
  })

  // Preferred over wallet.hasAddress in computed properties and templates: hasAddress reads the
  // HD address cache, which mainnet-js owns and Vue therefore does not track. Unlike a direct
  // call, this one is tracked, so callers re-run when the cache advances.
  function walletHasAddress(address: string) {
    // The read is the subscription, without it reactive callers never re-run. walletUtxos stands
    // in for the cache because the store assigns it right after the getUtxos() calls that grow it.
    void walletUtxos.value;
    return wallet.value.hasAddress(address);
  }

  // undefined while the utxo set is still loading, matching walletUtxos
  const spendableUtxos = computed(() => {
    if (!walletUtxos.value) return undefined;
    return spendableFromUtxos(walletUtxos.value, reservedUtxos.value);
  })

  const reservedWalletUtxos = computed(() => {
    if (!walletUtxos.value) return undefined;
    return reservedFromUtxos(walletUtxos.value, reservedUtxos.value);
  })

  const reservedBalance = computed(() => {
    if (!reservedWalletUtxos.value) return undefined;
    return getBalanceFromUtxos(reservedWalletUtxos.value);
  })

  // Anything gating a spend on having enough BCH wants this rather than balance, so the check
  // matches the pool the transaction is built from
  const spendableBalance = computed(() => {
    if (!spendableUtxos.value) return undefined;
    return getBalanceFromUtxos(spendableUtxos.value);
  })

  const dappConnectionStoresInitDone = computed(() => isWcInitDone.value && isCcInitDone.value && isWizInitDone.value)
  const bcmrIndexer = computed(() => network.value == 'mainnet' ? settingsStore.bcmrIndexerMainnet : settingsStore.bcmrIndexerChipnet)

  // Index of the receive address shown on the wallet page. For HD wallets this skips addresses
  // the user marked as used; undefined for single-address wallets and when every address in the
  // discovery window is marked, which markAddressUsed refuses to bring about but another open
  // tab marking at the same time still can (see deriveFreshAddressIndex)
  const currentAddressIndex = computed(() => {
    // depositRawHistory and walletCache below sit outside Vue reactivity, walletUtxos is the
    // signal that they advanced (see walletHasAddress)
    void walletUtxos.value;
    // marks are kept but ignored while the setting is off, so the wallet hands out the same
    // address it would have without the feature
    if (!settingsStore.enableAddressMarking) return undefined;
    const activeWallet = _wallet.value;
    if (!(activeWallet instanceof HDWallet)) return undefined;
    return deriveFreshAddressIndex(
      (index) => (activeWallet.depositRawHistory[index]?.length ?? 0) > 0,
      (index) => activeWallet.walletCache.getByIndex(index, false).address,
      addressMarks.value,
      GAP_SIZE,
    );
  })

  const currentDepositAddress = computed(() => {
    const activeWallet = _wallet.value;
    if (!activeWallet) return "";
    if (activeWallet instanceof HDWallet && currentAddressIndex.value !== undefined) {
      return activeWallet.getDepositAddress(currentAddressIndex.value);
    }
    return activeWallet.getDepositAddress();
  })

  const currentTokenDepositAddress = computed(() => {
    const activeWallet = _wallet.value;
    if (!activeWallet) return "";
    if (activeWallet instanceof HDWallet && currentAddressIndex.value !== undefined) {
      return activeWallet.getTokenDepositAddress(currentAddressIndex.value);
    }
    return activeWallet.getTokenDepositAddress();
  })

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

  // Counter to detect stale async operations after network/wallet switches.
  // Bumped whenever the state those operations write into is discarded, so at the start of
  // initializeWallet() and in resetWalletState(); checked after long awaits.
  let currentInitialization = 0;

  // Lets the 'online' event listener retry an initialization aborted while offline
  let abortedInitOffline = false;

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
      const connectionMainnet = new Connection("mainnet", electrumWssUrl(settingsStore.electrumServerMainnet))
      // @ts-ignore currently no other way to set a specific provider
      newWallet.provider = connectionMainnet.networkProvider as ElectrumNetworkProvider
    }
    if(newWallet.network == NetworkType.Testnet){
      const connectionChipnet = new Connection("testnet", electrumWssUrl(settingsStore.electrumServerChipnet))
      // @ts-ignore currently no other way to set a specific provider
      newWallet.provider = connectionChipnet.networkProvider as ElectrumNetworkProvider
    }
    _wallet.value?.stop().catch(() => {});
    _wallet.value = newWallet;
    const newNetwork = newWallet.network == NetworkType.Mainnet ? "mainnet" : "chipnet";
    txNotes.value = loadTxNotes(newNetwork, newWallet.name);
    addressMarks.value = loadAddressMarks(newNetwork, newWallet.name);
    addressLabels.value = loadAddressLabels(newNetwork, newWallet.name);
    reservedUtxos.value = loadReservedUtxos(newNetwork, newWallet.name);
    utxoLabels.value = loadUtxoLabels(newNetwork, newWallet.name);
    identityCategories.value = loadIdentityCategories(newNetwork, newWallet.name);
    watchedAuthKeys.value = loadAuthKeyCategories(newNetwork, newWallet.name);
    dismissedIdentities.value = loadDismissedIdentities(newNetwork, newWallet.name);
    unseenIdentities.value = loadUnseenIdentities(newNetwork, newWallet.name);
    unnamedAuthheads.value = loadUnnamedAuthheads(newNetwork, newWallet.name);
    unnameableAuthheads.value = loadUnnameableAuthheads(newNetwork, newWallet.name);
    identities.value = undefined;
    publicationChecks.value = {};
    identityHistories.value = {};
    guardedIdentities.value = {};
    unidentifiedGuarded.value = {};
    settledNonKeys = [];
  }

  function setTxNote(txid: string, note: string) {
    txNotes.value = saveTxNote(network.value, wallet.value.name, txid, note);
  }

  // Mark a receive address as used so a fresh address is handed out, for when the user shared
  // an address but no payment has arrived yet. Refused when marking would leave no fresh address
  // inside the seed-restore discovery window; receiving a payment extends the window again.
  function markAddressUsed(address: string) {
    const activeWallet = wallet.value;
    if (!(activeWallet instanceof HDWallet)) return;
    const simulatedMarks = [...addressMarks.value, address];
    const freshIndexAfterMark = deriveFreshAddressIndex(
      (index) => (activeWallet.depositRawHistory[index]?.length ?? 0) > 0,
      (index) => activeWallet.walletCache.getByIndex(index, false).address,
      simulatedMarks,
      GAP_SIZE,
    );
    if (freshIndexAfterMark === undefined) {
      Notify.create({
        message: t('addressManagement.markLimitNotify'),
        icon: 'warning',
        color: "red"
      })
      return;
    }
    addressMarks.value = saveAddressMark(network.value, activeWallet.name, address);
    Notify.create({
      message: t('addressManagement.markedUsedNotify'),
      icon: 'info',
      timeout: 1000,
      color: "grey-6"
    })
  }

  function unmarkAddressUsed(address: string) {
    addressMarks.value = deleteAddressMark(network.value, wallet.value.name, address);
  }

  function setAddressLabel(address: string, label: string) {
    addressLabels.value = saveAddressLabel(network.value, wallet.value.name, address, label);
  }

  function setUtxoLabel(outpoint: string, label: string) {
    utxoLabels.value = saveUtxoLabel(network.value, wallet.value.name, outpoint, label);
  }

  async function initializeWallet() {
    let failedToConnectElectrum = false
    if(!_wallet.value) throw new Error("No Wallet set in global store")
    currentInitialization++;
    console.log(`Wallet initialization #${currentInitialization}`);
    // Capture value for closures to detect stale async operations
    const initialization = currentInitialization;

    walletInitialized.value = false;
    walletInitFailed.value = false;
    abortedInitOffline = false;
    await cancelWalletSubscriptions();

    // Verify wallet type metadata matches the actual wallet class
    const metadataType = settingsStore.getWalletType(activeWalletName.value);
    const isActuallyHD = _wallet.value instanceof HDWallet || _wallet.value instanceof TestNetHDWallet;
    if (metadataType === 'hd' && !isActuallyHD) {
      throw new Error(`Wallet type mismatch: metadata says 'hd' but wallet is single-address. This may indicate corrupted settings.`);
    }
    if (metadataType === 'single' && isActuallyHD) {
      throw new Error(`Wallet type mismatch: metadata says 'single' but wallet is HD. This may indicate corrupted settings.`);
    }

    // navigator.onLine is only trustworthy when false: abort early when certainly offline,
    // so the user gets one clear error instead of separate errors per connection attempt
    if (navigator.onLine === false) {
      // Mark the skipped dapp inits as done so code waiting on dappConnectionStoresInitDone doesn't hang
      isWcInitDone.value = true;
      isCcInitDone.value = true;
      isWizInitDone.value = true;
      walletInitFailed.value = true;
      abortedInitOffline = true;
      displayAndLogError(new Error(t('store.errors.deviceOffline')));
      return;
    }

    try {
      // // Kick off exchange rate fetch immediately, so it's available as soon as possible for fiat balance display during initialization
      void fetchExchangeRate();

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
      console.time('initialize dapp connection stores');
      // WizardConnect initialization is synchronous (key derivation only, connections are fire-and-forget)
      initializeWizardConnect();
      await Promise.all([initializeWalletConnect(), initializeCashConnect()]);
      console.timeEnd('initialize dapp connection stores');
      // wait until the electrumConnectionPromise is resolved
      await electrumConnectionPromise;
      if (initialization !== currentInitialization) return;
      // if electrum connection failed, cancel the rest of initialization
      if(failedToConnectElectrum) {
        walletInitFailed.value = true;
        return
      }
      // Fetch wallet utxos first, this result will be used in consecutive calls to avoid duplicate getUtxos() calls.
      // For HD wallets this also awaits address discovery (watchPromise), which primes per-address utxos and history.
      console.time('fetch wallet utxos');
      const walletAddressUtxos = await wallet.value.getUtxos()
      console.timeEnd('fetch wallet utxos');
      if (initialization !== currentInitialization) return;
      const balanceSats = getBalanceFromUtxos(walletAddressUtxos)
      // Fetch fiat balance and max amount to send in parallel
      // 'getMaxAmountToSend' combines multiple fetches (blockheight, relayfee, price) so is a bit slower
      console.time('fetch fiat balance & max amount to send');
      // Filtered off the local array rather than the spendableUtxos computed, since walletUtxos
      // is only assigned further down to keep the UI values appearing together
      const promiseMaxAmountToSend = wallet.value.getMaxAmountToSend({
        options: { utxoIds: spendableFromUtxos(walletAddressUtxos, reservedUtxos.value) }
      });
      const balancePromises = [promiseMaxAmountToSend];
      const [resultMaxAmountToSend] = await Promise.all(balancePromises);
      console.timeEnd('fetch fiat balance & max amount to send');
      if (initialization !== currentInitialization) return;
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
      startRefetchIntervals();
      console.time('fetch initial history');
      await updateWalletHistory({ count: 100 })
      console.timeEnd('fetch initial history');
      walletInitialized.value = true;
      // resolve identities last because it is not critical
      console.time('resolve identities');
      await refreshIdentities();
      console.timeEnd('resolve identities');
    } catch (error) {
      // A stale initialization must not flag the newer one as failed
      if (initialization === currentInitialization) walletInitFailed.value = true;
      displayAndLogError(error);
    }
  }

  // A wallet constructed while offline cannot be reused: its HD address discovery never
  // settles (getUtxos would hang forever), so reset the stuck providers and rebuild it
  async function retryInitializationAfterOffline() {
    try {
      await disconnectProviders();
      const reloadedWallet = await loadExistingWallet(activeWalletName.value, network.value);
      setWallet(reloadedWallet);
      await initializeWallet();
    } catch (error) {
      displayAndLogError(error);
    }
  }

  // Only offline-aborted inits are retried: other init failures already ran their
  // dapp inits, so retrying would register duplicate callbacks
  addEventListener('online', () => {
    if (!abortedInitOffline) return;
    abortedInitOffline = false;
    void retryInitializationAfterOffline();
  });

  // Show the received-BCH toast; failures (fiat-rate fetch) must never affect wallet state
  async function showReceivedBchNotification(balanceDifferenceSats: bigint){
    try {
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
    } catch (error) {
      // skip the toast when the fiat-rate fetch fails (rate APIs unreachable)
      console.error("Failed to show received-BCH notification:", error);
    }
  }

  async function setUpWalletSubscriptions(){
    // watchTokenTransactions fires unawaited getRawTransactionObject calls for all existing txids on setup.
    // Some resolve after walletInitialized flips true, bypassing the init guard below.
    // Prefilling from getRawHistory prevents those late arrivals from triggering false "new token" notifications.
    // Remove seenTokenTxIds (prefill + check) if mainnet-js starts awaiting the initial watchTransactionHashes burst.
    const seenTokenTxIds = new Set<string>();
    try {
      // For single-address wallets this is one extra electrum call; for HD wallets it reads from in-memory cache (free).
      const existingHistory = await wallet.value.getRawHistory();
      existingHistory.forEach((tx) => seenTokenTxIds.add(tx.tx_hash));
    } catch (error) {
      console.error("Failed to prefill token transaction dedupe set:", error);
    }
    // Capture initialization so subscription callbacks become no-ops after a wallet/network switch
    const initialization = currentInitialization;

    cancelWatchBchtxs = await wallet.value.watchBalance(
      // use runAsyncVoid to wrap an async function as a synchronous callback
      // this means the promise is fire-and-forget
      (newBalance) => runAsyncVoid(async () => {
        if (initialization !== currentInitialization) return;
        // Compute oldBalance including bch on token utxos
        // to match way newBalance is calculated in watchBalance
        const oldBalance = walletUtxos.value?.reduce((acc, utxo) => acc + utxo.satoshis, BigInt(0));
        // explicit undefined check because 0n is falsy: a truthiness check would freeze
        // an empty wallet receiving its first funds and hide a wallet drained to zero
        if(oldBalance !== undefined && walletInitialized.value){
          // fire-and-forget so the notification (which may fetch a fiat rate) never
          // delays or blocks the state update below
          if(oldBalance < newBalance) void showReceivedBchNotification(newBalance - oldBalance);
          // update state (skipped on the initial trigger via the walletInitialized check)
          const walletAddressUtxos = await wallet.value.getUtxos();
          // update balance with the amount on bch-only utxos
          const balanceSats = getBalanceFromUtxos(walletAddressUtxos)
          balance.value = balanceSats;
          walletUtxos.value = walletAddressUtxos;
          void updateWalletHistory();
          // getMaxAmountToSend makes electrum calls (blockheight, relayfee) which can reject;
          // reset to undefined on failure so a stale send-limit isn't kept next to a fresh balance
          try {
            maxAmountToSend.value = await wallet.value.getMaxAmountToSend({ options:{
              utxoIds: spendableFromUtxos(walletAddressUtxos, reservedUtxos.value)
            }});
          } catch (error) {
            maxAmountToSend.value = undefined;
            console.error("Failed to update maxAmountToSend:", error);
          }
        }
      })
    );
    cancelWatchTokenTxs = await wallet.value.watchTokenTransactions(
      // use runAsyncVoid to wrap an async function as a synchronous callback
      // this means the promise is fire-and-forget
      (tx) => runAsyncVoid(async () => {
        if (initialization !== currentInitialization) return;
        // Guard: the initial watchStatus invocation fires callbacks for all existing txs
        // before walletInitialized is set to true, so skip those
        if(!walletInitialized.value) return

        // Catch late-resolving initial burst callbacks (see prefill above)
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
        void updateWalletHistory();
      })
    );
    cancelWatchBlocks = await wallet.value.watchBlocks(header => {
      if (initialization !== currentInitialization) return;
      currentBlockHeight.value = header.height;
    }, false);
  }

  async function resetWalletState({ resetDappConnections = true } = {}){
    // Bump the initialization counter before anything else, so the fetches already in flight
    // become no-ops. Without it, a reply arriving late from the old wallet or server would
    // repopulate the state cleared below.
    currentInitialization++;
    viewStack.length = 0;
    walletInitialized.value = false;
    walletInitFailed.value = false;

    // Stop the intervals and clear the state before the awaits below, so the views do not go on
    // showing the old wallet's balance and history for as long as cancelling takes.
    stopRefetchIntervals();
    balance.value = undefined;
    maxAmountToSend.value = undefined;
    walletUtxos.value = undefined;
    reservedUtxos.value = {}; // setWallet loads the incoming wallet's own set
    pendingTokenSearch.value = undefined;
    tokenList.value = null;
    bcmrRegistries.value = undefined;
    queriedHistoryCategories = [];
    cauldronPrices.value = null;
    cauldronPools.value = null;
    badgerLocks.value = null;
    tapswapListings.value = null;
    tapswapRegistries.value = {};
    hodlContracts.value = null;
    announcedAssetsError.value = undefined;
    exchangeRate.value = undefined;
    walletHistory.value = undefined;
    isHistoryPartial.value = false;

    if (resetDappConnections) {
      // Reset WC/CC/Wiz init-done flags so re-initialization runs after reset
      isWcInitDone.value = false;
      isCcInitDone.value = false;
      isWizInitDone.value = false;

      // Await WC/CC/Wiz cleanup so stop() finishes before start() can be called again
      const cleanupPromises = networkChangeCallbacks.map(callback => callback().catch(() => {}));
      await Promise.all(cleanupPromises);
      // Clear the networkChangeCallbacks before initialising newWallet
      networkChangeCallbacks = [];
    }

    // cancel active listeners
    await cancelWalletSubscriptions();
  }

  // Avoid WalletClass.named() here: it creates a fresh random wallet if the name is missing.
  // Loading must reconstruct from the saved walletId; .named() is only for creation flows.
  async function loadExistingWallet(walletName: string, network: 'mainnet' | 'chipnet'): Promise<WalletType> {
    const dbName = network === 'mainnet' ? 'bitcoincash' : 'bchtest';
    const walletId = await getNamedWalletIdFromDb(walletName, dbName);
    if (!walletId) {
      throw new Error(t('store.errors.walletNotFoundOnNetwork', { name: walletName, network }));
    }
    // The stored id says which kind this is, so write it every time rather than only when it is
    // missing: metadata is keyed by wallet name, and a stale type from an earlier wallet of the
    // same name would otherwise stand forever
    settingsStore.setWalletType(walletName, walletTypeFromWalletId(walletId));
    const loadedWallet = await loadWalletFromId(walletId, network);
    loadedWallet.name = walletName;
    return loadedWallet;
  }

  // Resets all wallet state and makes the given (already loaded) wallet the active one
  async function activateWallet(
    newWallet: WalletType,
    network: 'mainnet' | 'chipnet',
    awaitWalletInitialization: boolean = false
  ){
    await resetWalletState();
    setWallet(newWallet);
    if (awaitWalletInitialization) {
      await initializeWallet();
    } else {
      // fire-and-forget promise does not wait on full wallet initialization
      void initializeWallet();
    }
    localStorage.setItem('network', network);
    changeView(1);
  }

  // Switching networks resets all wallet state and reinitializes the wallet on the new network
  async function changeNetwork(
    newNetwork: 'mainnet' | 'chipnet',
    awaitWalletInitialization: boolean = false
  ){
    // Load the wallet on the new network first: if it does not exist there,
    // this throws and the current wallet state is left untouched
    let newWallet: WalletType;
    try {
      newWallet = await loadExistingWallet(activeWalletName.value, newNetwork);
    } catch (error) {
      displayAndLogError(error);
      return;
    }
    await activateWallet(newWallet, newNetwork, awaitWalletInitialization);
  }

  interface SwitchWalletResult {
    success: true;
    networkChanged?: 'mainnet' | 'chipnet'; // Set if network was changed to accommodate wallet
  }

  async function switchWallet(walletName: string): Promise<SwitchWalletResult> {
    // Get the current network from localStorage (default to mainnet)
    const currentNetwork = (localStorage.getItem('network') ?? 'mainnet') as 'mainnet' | 'chipnet';

    // If the wallet doesn't exist on the current network, target a network where it does
    // (availableWallets may be stale, loadExistingWallet below re-checks IndexedDB)
    let targetNetwork = currentNetwork;
    const walletInfo = availableWallets.value.find(w => w.name === walletName);
    if (walletInfo) {
      const networkSelector = currentNetwork === 'mainnet' ? 'hasMainnet' : 'hasChipnet';
      if (!walletInfo[networkSelector]) {
        targetNetwork = walletInfo.hasMainnet ? 'mainnet' : 'chipnet';
      }
    }

    const newWallet = await loadExistingWallet(walletName, targetNetwork);
    // Only update state after successful wallet load
    activeWalletName.value = walletName;
    localStorage.setItem('activeWalletName', walletName);
    await activateWallet(newWallet, targetNetwork);
    if (targetNetwork !== currentNetwork) {
      return { success: true, networkChanged: targetNetwork };
    }
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
    removeTxNotes(walletName);
    removeAddressManagementData(walletName);
    removeReservedUtxos(walletName);
    removeUtxoLabels(walletName);
    removePledges(walletName);
    removeIdentityCategories(walletName);
    settingsStore.clearWalletSettings(walletName);
    // Refresh the available wallets list
    await refreshAvailableWallets();
    // mainnet-js stores a private key for every address of an HD wallet. This deletes the cached
    // keys of any wallet no longer in the databases, not only the one just deleted, so it also
    // picks up keys left by wallets deleted before this existed, whatever kind just went.
    // The wallet is already gone by now, so a failure here is not a failed deletion.
    try {
      await pruneHdWalletKeyCache();
    } catch (error) {
      console.error(error);
      Notify.create({
        message: t('store.errors.cachedKeysNotCleared'),
        icon: 'warning',
        color: "red"
      })
    }
  }

  async function initializeWalletConnect() {
    try {
      const walletconnectStore = useWalletconnectStore()
      await walletconnectStore.initweb3wallet();

      // Setup network change callback to disconnect all sessions.
      networkChangeCallbacks.push(async () => {
        const sessions = walletconnectStore.web3wallet?.getActiveSessions();
        if(!sessions) return

        for (const session of Object.values(sessions)) {
          // deleteSession instead of raw disconnectSession so a single zombie session
          // can't throw and abort disconnecting the remaining sessions
          await walletconnectStore.deleteSession(session.topic);
        }
      });
    } catch (error) {
      console.error("Error initializing WalletConnect:", error);
      Notify.create({
        message: t('store.errors.errorInitializingWalletConnect'),
        icon: 'warning',
        color: "red"
      });
    } finally {
      // Always mark init as done so callers waiting on dappConnectionStoresInitDone don't hang forever
      isWcInitDone.value = true;
    }
  }

  async function initializeCashConnect() {
    try{
      // Initialize CashConnect.
      const cashconnectWallet = useCashconnectStore();

      // Start the wallet service.
      await cashconnectWallet.start();

      // Setup network change callback to stop the CashConnect service.
      // Sessions are not un-paired: they persist in localStorage (namespaced per wallet
      // identity key) and are restored by the next start() for the same wallet.
      // NOTE: This must be wrapped, otherwise we don't have the appropriate context.
      networkChangeCallbacks.push(async () => {
        await cashconnectWallet.stop();
      });

      // Monitor the wallet for balance changes and notify CashConnect to refresh wallet state.
      // Caught separately without a toast: watchBalance only fails when the electrum
      // connection is down, which already shows its own error toast.
      try {
        cancelWatchBchBalanceCashConnect = await wallet.value.watchBalance(() => {
          // Invoke wallet state has changed so that CashConnect can retrieve fresh UTXOs (and token balances).
          // fire-and-forget promise
          if(cashconnectWallet.cashConnectWallet) {
            void cashconnectWallet.cashConnectWallet.notifyBalancesChanged();
          }
        });
      } catch (error) {
        console.error("Error setting up CashConnect balance watching:", error);
      }
    } catch (error) {
      console.error("Error initializing CashConnect:", error);
      Notify.create({
        message: t('store.errors.errorInitializingCashConnect'),
        icon: 'warning',
        color: "red"
      });
    } finally {
      // Always mark init as done so callers waiting on dappConnectionStoresInitDone don't hang forever
      isCcInitDone.value = true;
    }
  }

  function initializeWizardConnect() {
    try {
      const wizardconnectStore = useWizardconnectStore();

      // Start the wizardconnect service (no-op for single-address wallets).
      wizardconnectStore.start();

      // Setup network change callback to disconnect all sessions.
      networkChangeCallbacks.push(() => {
        wizardconnectStore.stop();
        return Promise.resolve();
      });
    } catch (error) {
      console.error("Error initializing WizardConnect:", error);
      Notify.create({
        message: t('store.errors.errorInitializingWizardConnect'),
        icon: 'warning',
        color: "red"
      });
    } finally {
      // Always mark init as done so callers waiting on dappConnectionStoresInitDone don't hang forever
      isWizInitDone.value = true;
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

  // Fetches wallet history via mainnet-js getHistory().
  // When called with a capped count, auto-schedules a full background refresh via requestIdleCallback.
  let historyRequestId = 0;
  // Categories already queried for history metadata this session, so categories without
  // a BCMR record aren't re-queried on every history refresh (cachedFetch only caches successful lookups)
  let queriedHistoryCategories: string[] = [];
  async function updateWalletHistory({ count = -1 }: { count?: number } = {}) {
    const requestId = ++historyRequestId;
    try {
      const initialization = currentInitialization;
      const history = await wallet.value.getHistory({ count });
      if (initialization !== currentInitialization) return;
      if (requestId !== historyRequestId) return; // newer request in-flight, discard stale result
      walletHistory.value = history;
      // Track whether this is a partial load (capped fetch that may have more)
      isHistoryPartial.value = count > 0 && history.length >= count;
      // Automatically schedule background full load when partial
      if (isHistoryPartial.value) {
        // Schedule full history load when idle, fall back to setTimeout for unsupported environments
        const loadFullHistoryCallback = () => void updateWalletHistory();
        'requestIdleCallback' in globalThis ? requestIdleCallback(loadFullHistoryCallback) : setTimeout(loadFullHistoryCallback, 1000);
      }
      // Fetch metadata for history tokens no longer in the wallet, so their names, icons
      // and decimals still display. Fire-and-forget: history renders right away and the
      // metadata fills in reactively.
      const missingCategories: string[] = [];
      for (const tx of history) {
        for (const tokenChange of tx.tokenAmountChanges) {
          const category = tokenChange.category;
          if (bcmrRegistries.value?.[category] || queriedHistoryCategories.includes(category)) continue;
          queriedHistoryCategories.push(category);
          missingCategories.push(category);
        }
      }
      if (missingCategories.length) {
        void fetchTokenMetadata(missingCategories.map(category => ({ category, amount: 0n })), false);
      }
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
    const newTokenList = tokenListFromUtxos(walletUtxos.value, reservedUtxos.value);
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
    const initialization = currentInitialization;
    const registries = await fetchTokenMetadataFromIndexer(tokenList, fetchNftInfo, bcmrIndexer.value, bcmrRegistries.value);
    if (initialization !== currentInitialization) return;
    bcmrRegistries.value = registries
  }

  // Fetch BCH exchange rate for fiat display
  // mainnet-js has its own ~4 min TTL cache but we store the rate centrally for reactive access
  async function fetchExchangeRate() {
    try {
      const initialization = currentInitialization;
      const currency = settingsStore.currency;
      const rate = await ExchangeRate.get(currency, true);
      // discard a rate that no longer belongs: the state may have been reset, or the user may
      // have switched currency, which starts a second fetch that can resolve before this one
      if (initialization !== currentInitialization || currency !== settingsStore.currency) return;
      exchangeRate.value = rate;
    } catch (error) {
      console.error("Failed to fetch exchange rate:", error);
    }
  }

  // Fetch Cauldron prices for fungible tokens
  // 'force' bypasses the fiat-value display setting for flows that always need
  // prices, like the portfolio view the user explicitly opened
  async function fetchCauldronPricesForTokens(force = false) {
    if (!force && !settingsStore.showCauldronFTValue) return;
    // the token list only shows token values on mainnet, so outside the portfolio
    // there is nothing to fetch chipnet prices for
    if (!force && network.value !== 'mainnet') return;

    const fungibleTokens = tokenList.value?.filter(token => 'amount' in token) ?? [];
    const ftTokenIds = fungibleTokens.map(token => token.category);
    // a pool holds a token the wallet does not have to hold itself, so it needs a price too
    for (const pool of cauldronPools.value ?? []) {
      if (!ftTokenIds.includes(pool.tokenId)) ftTokenIds.push(pool.tokenId);
    }
    if (ftTokenIds.length === 0) return;

    const initialization = currentInitialization;
    const prices = await fetchCauldronPrices(ftTokenIds, network.value);
    // prices are network specific, discard them when the wallet or network changed meanwhile
    if (initialization !== currentInitialization) return;
    cauldronPrices.value = prices;
  }

  // The public key hashes that could own a Cauldron pool. On the wallet's own receive and change
  // chains an address that owns a pool signed the transaction creating it, so it has history and
  // addresses without history can be skipped. The dapp chain has no such history to go by: the
  // wallet never spends from it itself, so a fixed window of its addresses is checked.
  function walletPublicKeyHashes() {
    const activeWallet = wallet.value;
    if (!(activeWallet instanceof HDWallet)) {
      const publicKeyHash = publicKeyHashFromAddress(activeWallet.getDepositAddress());
      return publicKeyHash ? [publicKeyHash] : [];
    }
    const publicKeyHashes: string[] = [];
    for (const change of [false, true]) {
      const rawHistory = change ? activeWallet.changeRawHistory : activeWallet.depositRawHistory;
      const lastIndex = (change ? activeWallet.changeIndex : activeWallet.depositIndex) + GAP_SIZE;
      for (let i = 0; i <= lastIndex; i++) {
        if (!rawHistory[i]?.length) continue;
        const publicKeyHash = publicKeyHashFromAddress(activeWallet.walletCache.getByIndex(i, change).address);
        if (publicKeyHash) publicKeyHashes.push(publicKeyHash);
      }
    }
    publicKeyHashes.push(
      ...cauldronChainPublicKeyHashes(activeWallet.mnemonic, activeWallet.derivation, GAP_SIZE)
    );
    return publicKeyHashes;
  }

  // Find the Cauldron liquidity pools the wallet owns. Pools are not held as a token or an NFT,
  // they live at the pool contract address derived from the owner's public key hash, so this is
  // a UTXO lookup per wallet address. Only the portfolio view shows them, so it drives the fetch.
  async function fetchWalletCauldronPools() {
    // the portfolio view can ask before the wallet is set, the retry comes with the token list
    if (!_wallet.value) return;
    try {
      const initialization = currentInitialization;
      const pools = await fetchCauldronPools(
        wallet.value.provider, walletPublicKeyHashes(), wallet.value.networkPrefix
      );
      if (initialization !== currentInitialization) return;
      cauldronPools.value = pools;

      // the token in a pool does not have to be held by the wallet, so its metadata can be missing
      const poolTokens: TokenList = [];
      for (const pool of pools) {
        const metadataAlreadyFetched = bcmrRegistries.value?.[pool.tokenId] !== undefined
          || poolTokens.some(poolToken => poolToken.category === pool.tokenId);
        if (!metadataAlreadyFetched) poolTokens.push({ category: pool.tokenId, amount: pool.tokenAmount });
      }
      if (poolTokens.length) await fetchTokenMetadata(poolTokens, false);
    } catch (error) {
      // swallowed so the portfolio still gets to fetch its prices, without which every token
      // would show up as unpriced; the empty list also lets the view render instead of waiting
      console.error("Failed to look up Cauldron pools:", error);
      cauldronPools.value ??= [];
    }
  }

  // Find the BCH the wallet has locked in the Badgers.cash contract. The wallet holds nothing
  // that represents a lock, they all sit at the contract address with the owner in their
  // commitment, so this is one lookup there. Only the portfolio view shows them, so it drives
  // the fetch. The contract is mainnet only, on chipnet there is nothing to look up.
  async function fetchWalletBadgerLocks() {
    // the portfolio view can ask before the wallet is set, the retry comes with the token list
    if (!_wallet.value) return;
    if (network.value !== 'mainnet') {
      badgerLocks.value = [];
      return;
    }
    try {
      const initialization = currentInitialization;
      const locks = await fetchBadgerLocks(wallet.value.provider, walletPublicKeyHashes());
      if (initialization !== currentInitialization) return;
      badgerLocks.value = locks;
    } catch (error) {
      // swallowed like the Cauldron lookup, so one unreachable request does not keep the
      // portfolio from rendering everything else
      console.error("Failed to look up Badgers.cash locks:", error);
      badgerLocks.value ??= [];
    }
  }

  // Find the wallet's TapSwap listings and hodl contracts. Both are held by contracts, so the
  // wallet holds nothing that represents them, and both are announced by an OP_RETURN on a
  // transaction the wallet funded, so one Chaingraph walk of the transactions that spent the
  // wallet's outputs feeds both lookups. Only the portfolio view shows them, so it drives the
  // fetch. Both protocols are mainnet only.
  async function fetchWalletAnnouncedAssets() {
    if (network.value !== 'mainnet') {
      tapswapListings.value = [];
      hodlContracts.value = [];
      return;
    }
    announcedAssetsError.value = undefined;
    try {
      const initialization = currentInitialization;
      const ownerPkhs = walletPublicKeyHashes();
      const spentOutputs = await querySpentOutputs(ownerPkhs, settingsStore.chaingraph);
      if (initialization !== currentInitialization) return;
      const listings = listingsFromSpentOutputs(spentOutputs, ownerPkhs);
      tapswapListings.value = listings;

      // the same walk, read a third way: identities these keys made
      await detectWalletIdentities(spentOutputs);
      if (initialization !== currentInitialization) return;

      const hodlCandidates = hodlContractsFromSpentOutputs(spentOutputs, ownerPkhs);
      const contracts = await fetchHodlContractStates(wallet.value.provider, hodlCandidates);
      if (initialization !== currentInitialization) return;
      hodlContracts.value = contracts;

      // NFT listings fetch their NFT-specific metadata (name, icon), which carries the
      // collection metadata with it; fungible listings fetch the category metadata. The
      // fetches merge into tapswapRegistries in place.
      for (const listing of listings) {
        if (initialization !== currentInitialization) return;
        if (listing.commitment !== undefined) {
          if (tapswapRegistries.value[listing.category]?.nfts?.[listing.commitment]) continue;
          await fetchNftMetadataFromIndexer(listing.category, listing.commitment, bcmrIndexer.value, tapswapRegistries.value);
          continue;
        }
        if (tapswapRegistries.value[listing.category]) continue;
        await fetchTokenMetadataFromIndexer(
          [{ category: listing.category, amount: listing.tokenAmount }], false, bcmrIndexer.value, tapswapRegistries.value
        );
      }
    } catch (error) {
      // shown inline in the portfolio view rather than toasted: this fetch re-runs on
      // every portfolio entry, so an unreachable server would toast on each visit
      console.error("Failed to look up TapSwap listings and hodl contracts:", error);
      announcedAssetsError.value = error instanceof ChaingraphRequestError
        ? error.message
        : t('portfolio.announcedAssetsLoadingFailed');
      tapswapListings.value ??= [];
      hodlContracts.value ??= [];
    }
  }

  // Periodically refetch exchange rate and Cauldron prices on separate intervals
  function startRefetchIntervals() {
    stopRefetchIntervals();
    exchangeRateInterval = setInterval(() => void fetchExchangeRate(), EXCHANGE_RATE_REFETCH_INTERVAL_MS);
    cauldronPriceInterval = setInterval(() => void fetchCauldronPricesForTokens(), CAULDRON_REFETCH_INTERVAL_MS);
  }

  function stopRefetchIntervals() {
    if (exchangeRateInterval) {
      clearInterval(exchangeRateInterval);
      exchangeRateInterval = undefined;
    }
    if (cauldronPriceInterval) {
      clearInterval(cauldronPriceInterval);
      cauldronPriceInterval = undefined;
    }
  }

  // Refetch exchange rate when user changes currency
  watch(() => settingsStore.currency, () => void fetchExchangeRate());
  // Keep the default-server list current after a settings change. This governs the server used when
  // a wallet is constructed for a network not yet connected this session (mainnet-js caches a global
  // provider per network on first construction, so an already-connected network keeps its provider
  // until it reconnects). The active wallet's server is swapped directly by the settings handler.
  watch([() => settingsStore.electrumServerMainnet, () => settingsStore.electrumServerChipnet], setDefaultElectrumServers);

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


  async function parseNftCommitment(categoryId: string, utxo: Utxo) {
    const metadata = bcmrRegistries.value?.[categoryId];
    return parseNftCommitmentUtil(utxo, metadata, wallet.value.provider, wallet.value.networkPrefix);
  }

  // Identities these keys made, found in the walk rather than asked for. This is the one place
  // the wallet lists something the user did not: the creator whose authhead sits here as an
  // anonymous coin is exactly the one who never opens the page, and an ordinary send spends it.
  // Deliberately amends the rule that only listed identities are reserved: the walk is evidence,
  // not a guess, and the coin is an authhead.
  function listDetectedIdentities(spentOutputs: ChaingraphSpentOutput[]) {
    const heldAuthheads = (walletUtxos.value ?? []).filter(utxo => utxo.vout === 0);
    const found = detectIdentities(spentOutputs).filter(
      identity => heldAuthheads.some(utxo => utxo.txid === identity.authheadTxid)
    );
    const listed: string[] = [];
    for (const identity of found) {
      // a chain the markers cannot name is protected all the same, by outpoint: naming it comes
      // after, and is never a condition of protecting it
      if (!identity.category) {
        if (dismissedIdentities.value.includes(identity.authheadTxid)) continue;
        if (unnamedAuthheads.value.includes(identity.authheadTxid)) continue;
        unnamedAuthheads.value = saveUnnamedAuthhead(network.value, wallet.value.name, identity.authheadTxid);
        listed.push(identity.authheadTxid);
        continue;
      }
      if (dismissedIdentities.value.includes(identity.category)) continue;
      if (identityCategories.value.includes(identity.category)) continue;
      identityCategories.value = saveIdentityCategory(network.value, wallet.value.name, identity.category);
      listed.push(identity.category);
    }
    if (!listed.length) return listed;
    unseenIdentities.value = saveUnseenIdentities(network.value, wallet.value.name, listed);
    Notify.create({
      type: 'info',
      message: t('identities.detected.notification', listed.length),
      timeout: 8000,
    });
    return listed;
  }

  // Reading the walk the portfolio already makes, so no new backend and no new round trip
  async function detectWalletIdentities(spentOutputs: ChaingraphSpentOutput[]) {
    identityPublicationTxids.value = publicationTxids(spentOutputs);
    if (!listDetectedIdentities(spentOutputs).length) return;
    // protection first, so it never depends on the naming below working
    await refreshIdentities();
    if (await nameUnnamedAuthheads()) await refreshIdentities();
  }

  // The explicit check's deeper half: every held vout-0 coin that is not already accounted for is
  // walked back to see whether it is the authhead of some category. The same primitive naming
  // already uses, pointed at coins rather than at publications.
  async function deepScanHeldCoins() {
    const fetchTransaction = (txid: string) => wallet.value.provider.getRawTransactionObject(txid);
    const listedAuthheads = (identities.value ?? []).map(identity => identity.authheadTxid);
    const candidates = (walletUtxos.value ?? []).filter(utxo =>
      utxo.vout === 0
      && !listedAuthheads.includes(utxo.txid)
      && !unnamedAuthheads.value.includes(utxo.txid)
      && !dismissedIdentities.value.includes(utxo.txid)
    );
    let found = 0;
    for (const coin of candidates) {
      const initialization = currentInitialization;
      const walked = await nameChainByWalkingBack(coin.txid, fetchTransaction);
      if (initialization !== currentInitialization) return found;
      if (walked.outcome !== 'named') continue;
      const category = walked.category;
      if (identityCategories.value.includes(category)) continue;
      if (dismissedIdentities.value.includes(category)) continue;
      // the walk says which genesis, the forward query says that genesis still ends at this coin
      const confirmed = await queryAuthHeadWithOutputs(category, settingsStore.chaingraph)
        .then(result => result.txid === coin.txid)
        .catch(() => false);
      if (initialization !== currentInitialization) return found;
      if (!confirmed) continue;
      identityCategories.value = saveIdentityCategory(network.value, wallet.value.name, category);
      found += 1;
    }
    return found;
  }

  // Naming what is already protected. Each unnamed authhead is walked back to its genesis over
  // electrum, and the category that walk returns is confirmed forward through the authhead query
  // the rest of the page uses: the walk says which genesis, and the confirmation says that genesis
  // still ends here. A name that does not confirm is discarded and the coin stays protected.
  async function nameUnnamedAuthheads() {
    const coins = unnamedAuthheadCoins();
    if (!coins.length) return 0;
    const fetchTransaction = (txid: string) => wallet.value.provider.getRawTransactionObject(txid);
    let named = 0;
    for (const coin of coins) {
      if (unnameableAuthheads.value.includes(coin.txid)) continue;
      const initialization = currentInitialization;
      const walked = await nameChainByWalkingBack(coin.txid, fetchTransaction);
      if (initialization !== currentInitialization) return named;
      if (walked.outcome === 'unnameable') {
        unnameableAuthheads.value = saveUnnameableAuthhead(network.value, wallet.value.name, coin.txid);
        continue;
      }
      // 'unavailable' says nothing about the chain, so it is simply tried again next time
      if (walked.outcome !== 'named') continue;
      const category = walked.category;
      const confirmed = await queryAuthHeadWithOutputs(category, settingsStore.chaingraph)
        .then(result => result.txid === coin.txid)
        .catch(() => false);
      if (initialization !== currentInitialization) return named;
      if (!confirmed) continue;
      unnamedAuthheads.value = deleteUnnamedAuthhead(network.value, wallet.value.name, coin.txid);
      if (identityCategories.value.includes(category)) continue;
      identityCategories.value = saveIdentityCategory(network.value, wallet.value.name, category);
      named += 1;
    }
    return named;
  }

  // An identity's own history, which is the chain itself: what each link did, and the reserve
  // read down the list, which is the issuance schedule. One query, and only when a card asks for
  // it: this is the one identity query that grows with a chain's length.
  const identityHistories = ref({} as Record<string, DescribedLink[]>);

  async function fetchIdentityHistory(category: string) {
    if (identityHistories.value[category]) return;
    const links = await queryAuthchainLinks(category, settingsStore.chaingraph);
    identityHistories.value = {
      ...identityHistories.value,
      [category]: describeChainLinks(links),
    };
  }

  // The page has been opened, so what it found on its own is no longer news
  function markIdentitiesSeen() {
    const unseen = unseenIdentities.value;
    clearUnseenIdentities(network.value, wallet.value.name);
    unseenIdentities.value = [];
    return unseen;
  }

  // What the AuthKeys this wallet holds are guarding. The fingerprint is local and free, the guard
  // listing is not, so it runs only where resolution runs and skips candidates already settled as
  // ordinary NFTs. A key is confirmed by its covenant holding something, never by shape alone:
  // freezing an innocent NFT on a lucky commitment would be protection nobody asked for.
  async function resolveAuthKeys() {
    const heldCandidates = (walletUtxos.value ?? []).filter(
      utxo => isAuthKeyCandidate(utxo) && !settledNonKeys.includes(utxo.token!.category)
    );
    // A watched key has no coin here; its guard is derived and listed the same way, and what it
    // holds reads as watched rather than held.
    const candidates: { category: string, keyUtxo?: Utxo }[] = [
      ...heldCandidates.map(keyUtxo => ({ category: keyUtxo.token!.category, keyUtxo })),
      ...watchedAuthKeys.value
        .filter(category => !heldCandidates.some(utxo => utxo.token!.category === category))
        .map(category => ({ category })),
    ];
    const guarded: Record<string, GuardedIdentity> = {};
    const unidentified: Record<string, number> = {};
    for (const { category, keyUtxo } of candidates) {
      const guardAddresses = authGuardAddresses(category, wallet.value.networkPrefix);
      // both hash lengths a covenant address can use, since deployments exist in both
      const guardUtxos = await Promise.all([
        wallet.value.provider.getUtxos(guardAddresses.p2sh20.tokenAddress),
        wallet.value.provider.getUtxos(guardAddresses.p2sh32.tokenAddress),
      ]);
      const contents = [
        { addresses: guardAddresses.p2sh20, contents: guardContentsFromUtxos(guardUtxos[0]) },
        { addresses: guardAddresses.p2sh32, contents: guardContentsFromUtxos(guardUtxos[1]) },
      ];
      const found = contents.reduce((total, guard) =>
        total + guard.contents.identified.length + guard.contents.unidentified, 0);
      if (!found) {
        // only a held candidate is a guess worth settling; a watched one the user named stays
        if (keyUtxo) settledNonKeys.push(category);
        continue;
      }
      unidentified[category] = contents.reduce((total, guard) => total + guard.contents.unidentified, 0);
      for (const guard of contents) {
        for (const output of guard.contents.identified) {
          guarded[output.category] = {
            category: output.category,
            authheadTxid: output.utxo.txid,
            identityOutput: output.utxo,
            ...(keyUtxo ? { keyUtxo } : {}),
            guardAddress: guard.addresses.tokenAddress,
          };
        }
      }
    }
    guardedIdentities.value = guarded;
    unidentifiedGuarded.value = unidentified;
    return guarded;
  }

  // Where each listed identity's authhead sits now. Nothing about an authhead is restored from
  // storage: it moves to a new outpoint every time the identity's metadata is updated, and those
  // updates happen outside this wallet, so the outpoint is re-resolved and the 'auth' reservations
  // are rewritten from the result. That is what makes a reservation follow the authchain.
  // This is the single owner of both the list and those reservations: everything that changes what
  // is listed writes the categories and then hands the resolving over to it.
  async function resolveListedIdentities() {
    const currentUtxos = walletUtxos.value;
    if (!currentUtxos) return;
    // before the listing is read, since a guarded identity found here joins it
    const guarded = await resolveAuthKeys();
    for (const category of Object.keys(guarded)) {
      if (identityCategories.value.includes(category)) continue;
      identityCategories.value = saveIdentityCategory(network.value, wallet.value.name, category);
    }
    if (!identityCategories.value.length) {
      identities.value = [];
      // still runs: it reserves the unnamed authheads, and clears an 'auth' reservation left
      // behind by an identity that is no longer listed
      await syncAuthReservations([]);
      return;
    }
    const initialization = currentInitialization;
    const resolved = await resolveIdentities(
      identityCategories.value, settingsStore.chaingraph, currentUtxos, guarded
    );
    if (initialization !== currentInitialization) return;
    identities.value = resolved;
    forgetStaleHistories(resolved);
    await syncAuthReservations(resolved);
  }

  // A cached chain ends at the authhead it was fetched for, so an authhead that has moved since
  // means the cache is missing its newest link. Keyed on the authhead rather than on this wallet
  // having spent it, so an update made elsewhere with the same keys invalidates it too.
  function forgetStaleHistories(resolved: IdentityState[]) {
    const stale = resolved.filter(identity => {
      const cached = identityHistories.value[identity.category];
      return cached?.length && cached[cached.length - 1]!.hash !== identity.authheadTxid;
    });
    if (!stale.length) return;
    const histories = { ...identityHistories.value };
    for (const identity of stale) delete histories[identity.category];
    identityHistories.value = histories;
  }

  async function refreshIdentities() {
    if (identitiesResolving.value) return;
    identitiesResolving.value = true;
    try {
      await resolveListedIdentities();
    } finally {
      identitiesResolving.value = false;
    }
  }

  // Every authhead the wallet holds as a BCH-only coin is held back from coin selection, and an
  // 'auth' reservation on a coin that is no longer one is dropped. A failed query says nothing
  // about where its authhead went, so nothing is dropped while any identity is unresolved: an
  // outage leaves coins locked rather than releasing them.
  // The held authheads that carry no identity of their own on the list: same protection, no name
  function unnamedAuthheadCoins() {
    return (walletUtxos.value ?? []).filter(
      utxo => utxo.vout === 0 && unnamedAuthheads.value.includes(utxo.txid)
    );
  }

  async function syncAuthReservations(resolved: IdentityState[]) {
    const authOutpoints: string[] = [];
    for (const coin of unnamedAuthheadCoins()) {
      const outpoint = outpointOf(coin);
      authOutpoints.push(outpoint);
      if (!reservedUtxos.value[outpoint]) await reserveUtxo(coin, 'auth');
    }
    for (const identity of resolved) {
      // the identity output when this wallet holds it, the AuthKey when a covenant does: either
      // way it is the coin the authority rides on, and one key can carry several identities
      const keyCoin = identityKeyCoin(identity);
      if (!keyCoin) continue;
      const outpoint = outpointOf(keyCoin);
      authOutpoints.push(outpoint);
      // A reservation already made for another reason is left alone: the coin is held back either
      // way, and rewriting the reason would take it away from whatever made it
      if (!reservedUtxos.value[outpoint]) await reserveUtxo(keyCoin, 'auth');
    }
    if (resolved.some(identity => identity.status === 'unresolved')) return;
    for (const [outpoint, reservation] of Object.entries(reservedUtxos.value)) {
      if (reservation.reason !== 'auth') continue;
      if (authOutpoints.includes(outpoint)) continue;
      await dropReservation(outpoint);
    }
  }

  // The explicit check for authhead ownership, over the categories this wallet holds tokens of.
  // A found authhead joins the list the same way a manual add does, whether or not it carries a
  // reserve. Categories with no held supply are not covered here and stay a manual add.
  async function scanForIdentities(): Promise<IdentityScanSummary | undefined> {
    if (identitiesResolving.value) return undefined;
    const currentUtxos = walletUtxos.value;
    if (!currentUtxos) return undefined;
    const heldCategories = (tokenList.value ?? []).map(token => token.category);
    const listedCount = heldCategories.filter(category => identityCategories.value.includes(category)).length;
    const categoriesToCheck = heldCategories.filter(category => !identityCategories.value.includes(category));
    identitiesResolving.value = true;
    try {
      const initialization = currentInitialization;
      const resolved = await resolveIdentities(categoriesToCheck, settingsStore.chaingraph, currentUtxos);
      if (initialization !== currentInitialization) return undefined;
      const found = resolved.filter(
        identity => identity.authUtxo && !dismissedIdentities.value.includes(identity.category)
      );
      const dismissed = resolved.filter(
        identity => identity.authUtxo && dismissedIdentities.value.includes(identity.category)
      ).length;
      for (const identity of found) {
        identityCategories.value = saveIdentityCategory(network.value, wallet.value.name, identity.category);
      }
      // The one case the categories cannot reach: an authhead received from elsewhere, with no
      // token of its own held here and no activity by these keys to have been walked. Its coin is
      // walked back to a genesis instead, which costs a fetch a hop, hence only on the user's word.
      const deepScanned = await deepScanHeldCoins();

      // The list and its reservations are resolved whole rather than merged into here: a few
      // repeated queries for what the scan just found buy a single owner of that state.
      await resolveListedIdentities();
      return {
        found: found.length + deepScanned,
        alreadyListed: listedCount,
        carriesTokens: resolved.filter(identity => identity.status === 'carriesTokens').length,
        failed: resolved.filter(identity => identity.status === 'unresolved').length,
        dismissed,
        deepScanned,
      };
    } finally {
      identitiesResolving.value = false;
    }
  }

  // A spend that names one specific coin, an NFT transfer or burn, cannot fall back on another the
  // way an amount can, so a held back one is refused here rather than left to fail on mainnet-js's
  // terms. Frozen coins are spendable deliberately, but from utxo management rather than from here.
  function checkTokenUtxosSpendable(utxos: Utxo[]) {
    if (utxos.some(utxo => outpointOf(utxo) in reservedUtxos.value)) {
      throw new Error(t('store.errors.tokenUtxoHeldBack'));
    }
  }

  // Fetches every listed identity's published locations and compares what they serve against the
  // hash on chain. Only ever on the user opening the page: this reaches out to the identity's
  // hosting, which is not something to do quietly in the background on every wallet start.
  async function checkPublications() {
    const listed = identities.value?.filter(identity => identity.publication) ?? [];
    if (!listed.length) return;
    publicationChecksRunning.value = true;
    try {
      const initialization = currentInitialization;
      const checked = await Promise.all(listed.map(async identity => {
        const publication = identity.publication!;
        const checks = await Promise.all(publication.uris.map(
          uri => checkPublicationUri(uri, publication.hash, settingsStore.ipfsGateway)
        ));
        return [identity.category, checks] as const;
      }));
      if (initialization !== currentInitialization) return;
      publicationChecks.value = Object.fromEntries(checked);
    } finally {
      publicationChecksRunning.value = false;
    }
  }

  // The identities an AuthKey of this category guards, so the token list can render a key as what
  // it is rather than as an NFT with no metadata. Empty for anything that is not a confirmed key.
  function identitiesGuardedByKey(keyCategory: string) {
    return identities.value?.filter(
      identity => identity.keyUtxo?.token?.category === keyCategory
    ) ?? [];
  }

  // A token category and an AuthKey category are both 64 hex, so the add input does not ask which
  // one it was given: it tries both readings and reports what each found.
  async function inspectCategory(category: string) {
    const guardAddresses = authGuardAddresses(category, wallet.value.networkPrefix);
    const [authchain, p2sh20Utxos, p2sh32Utxos] = await Promise.all([
      queryAuthHeadWithOutputs(category, settingsStore.chaingraph).then(() => true).catch(() => false),
      wallet.value.provider.getUtxos(guardAddresses.p2sh20.tokenAddress),
      wallet.value.provider.getUtxos(guardAddresses.p2sh32.tokenAddress),
    ]);
    const contents = [guardContentsFromUtxos(p2sh20Utxos), guardContentsFromUtxos(p2sh32Utxos)];
    return {
      isTokenIdentity: authchain,
      guardedCategories: contents.flatMap(guard => guard.identified.map(output => output.category)),
      unidentifiedGuarded: contents.reduce((total, guard) => total + guard.unidentified, 0),
    };
  }

  async function addAuthKey(category: string) {
    watchedAuthKeys.value = saveAuthKeyCategory(network.value, wallet.value.name, category);
    await refreshIdentities();
  }

  function removeAuthKey(category: string) {
    watchedAuthKeys.value = deleteAuthKeyCategory(network.value, wallet.value.name, category);
  }

  async function addIdentity(category: string) {
    // adding by hand undoes a dismissal: the user changed their mind, which is the whole point
    dismissedIdentities.value = undismissIdentity(network.value, wallet.value.name, category);
    identityCategories.value = saveIdentityCategory(network.value, wallet.value.name, category);
    await refreshIdentities();
  }

  // An identity this wallet just created, token or not: its authhead is output 0 of the
  // transaction, so the coin is held back straight away rather than when Chaingraph or this
  // wallet's own view catches up.
  async function listCreatedIdentity(category: string, authheadTxId: string, authheadSatoshis: bigint) {
    dismissedIdentities.value = undismissIdentity(network.value, wallet.value.name, category);
    identityCategories.value = saveIdentityCategory(network.value, wallet.value.name, category);
    const outpoint = `${authheadTxId}:0`;
    if (!reservedUtxos.value[outpoint]) await reserveOutpoint(outpoint, authheadSatoshis, 'auth');
    await refreshIdentities();
  }

  // The wallet's only way to stop holding an authhead back, for when the user wants to spend that
  // coin outside the identities page. Adding the identity again, by category or through the
  // ownership check, reserves its authhead again.
  async function removeUnnamedAuthhead(txid: string) {
    dismissedIdentities.value = saveDismissedIdentity(network.value, wallet.value.name, txid);
    unnamedAuthheads.value = deleteUnnamedAuthhead(network.value, wallet.value.name, txid);
    const coin = (walletUtxos.value ?? []).find(utxo => utxo.vout === 0 && utxo.txid === txid);
    if (coin && reservedUtxos.value[outpointOf(coin)]?.reason === 'auth') {
      await dropReservation(outpointOf(coin));
    }
  }

  async function removeIdentity(category: string) {
    // remembered, so the automatic detection does not put it back on the next wallet open
    dismissedIdentities.value = saveDismissedIdentity(network.value, wallet.value.name, category);
    const removed = identities.value?.find(identity => identity.category === category);
    identityCategories.value = deleteIdentityCategory(network.value, wallet.value.name, category);
    identities.value = identities.value?.filter(identity => identity.category !== category);
    if (!removed?.authUtxo) return;
    const outpoint = outpointOf(removed.authUtxo);
    if (reservedUtxos.value[outpoint]?.reason === 'auth') await dropReservation(outpoint);
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

  // Token coins are held back the same way BCH coins are. That took the pool narrowing to reach
  // every spend path, mainnet-js's token methods included (see the pnpm patch), and the shortfall
  // messages below to say why a send that used to fit no longer does.
  async function reserveUtxo(utxo: Utxo, reason: ReservationReason) {
    reservedUtxos.value = saveReservedUtxo(
      network.value, wallet.value.name, utxo, reason, Math.floor(Date.now() / 1000)
    );
    // the fungible balances count what can be spent, and nothing else re-reads them on their own
    if (utxo.token) updateTokenList();
    await refreshMaxAmountToSend();
  }

  // Holds back a coin this wallet made but may not have seen yet. Reservations are keyed by
  // outpoint, so the coin does not have to be in hand to be kept out of the spendable pool.
  async function reserveOutpoint(outpoint: Outpoint, satoshis: bigint, reason: ReservationReason) {
    reservedUtxos.value = saveReservedOutpoint(
      network.value, wallet.value.name, outpoint, satoshis, reason, Math.floor(Date.now() / 1000)
    );
    updateTokenList();
    await refreshMaxAmountToSend();
  }

  // Drops a reservation without spending; cancelling a pledge goes through spend.releaseReservedCoin
  async function dropReservation(outpoint: string) {
    const releasedToken = walletUtxos.value?.find(utxo => outpointOf(utxo) === outpoint)?.token;
    reservedUtxos.value = deleteReservedUtxo(network.value, wallet.value.name, outpoint);
    if (releasedToken) updateTokenList();
    await refreshMaxAmountToSend();
  }

  // maxAmountToSend is fetched, not derived, so it does not follow the spendable pool on its own
  async function refreshMaxAmountToSend() {
    try {
      maxAmountToSend.value = await spend.getMaxAmountToSend();
    } catch (error) {
      maxAmountToSend.value = undefined;
      console.error("Failed to update maxAmountToSend:", error);
    }
  }

  type SpendOptions = Omit<SendRequestOptionsI, 'utxoIds'>;

  // Spending goes through store.spend so a reserved coin never enters mainnet-js's coin selection
  // utxoIds is only set while a coin is reserved, and from the wallet's current coins rather
  // than the walletUtxos ref: a snapshot that trails the wallet's own view fails the send.
  async function excludeReservedUtxos() {
    const hasReservedUtxos = Object.keys(reservedUtxos.value).length > 0;
    if (!hasReservedUtxos) return undefined;
    return spendableFromUtxos(await wallet.value.getUtxos(), reservedUtxos.value);
  }

  function createSpendConfig(options?: SpendOptions, utxoIds?: Utxo[]) {
    if (!utxoIds) return options;
    // utxoIds last, so a spread can never win over it
    return { ...options, utxoIds };
  }

  // An output is this wallet's when its locking bytecode reads as an address this wallet has;
  // an output that is not an address at all, like an OP_RETURN, never is.
  function ownsLockingBytecode(lockingBytecode: Bytes) {
    const prefix = network.value === 'mainnet' ? 'bitcoincash' : 'bchtest';
    const bytecode = typeof lockingBytecode === 'string' ? hexToBin(lockingBytecode) : lockingBytecode;
    const address = lockingBytecodeToCashAddress({ bytecode, prefix });
    if (typeof address === 'string') return false;
    return walletHasAddress(address.address);
  }

  // What the dapp signing paths ask before refusing a request that spends a held back coin: the
  // identity coins are named here, and the rule itself lives in utils/dapp/reservedInputs.ts.
  function checkDappReservedInputs(inputs: readonly SignedInput[], outputs: readonly SignedOutput[]) {
    const listed = identities.value ?? [];
    const identityKeys = listed.flatMap(identity => identity.keyUtxo ? [outpointOf(identity.keyUtxo)] : []);
    const heldAuthheads = listed.flatMap(identity => identity.authUtxo ? [outpointOf(identity.authUtxo)] : []);
    const unnamed = unnamedAuthheadCoins().map(outpointOf);
    return checkReservedInputs(inputs, outputs, {
      reservedUtxos: reservedUtxos.value,
      walletUtxos: walletUtxos.value ?? [],
      identityKeys,
      authheads: [...heldAuthheads, ...unnamed],
      ownsOutput: output => ownsLockingBytecode(output.lockingBytecode),
    });
  }

  // Narrowing utxoIds does not cover ensureUtxos: mainnet-js seeds its selection with every
  // ensureUtxos entry before it looks at the pool, so a reserved coin passed there would be spent.
  function checkNoReservedUtxos(options?: SpendOptions) {
    const ensured = options?.ensureUtxos;
    if (!ensured?.length) return;
    if (ensured.some(utxo => outpointOf(utxo) in reservedUtxos.value)) {
      throw new Error(t('store.errors.reservedEnsureUtxos'));
    }
  }

  // mainnet-js reports a spend it cannot fund against the pool it was handed, which is this
  // wallet's coins minus the ones held back. Read against a balance that includes those, its
  // numbers look wrong, so while anything is held back the message says what is missing from the
  // pool and where to see it. Errors with another cause are passed through untouched.
  function explainHeldBackCoins(error: unknown): unknown {
    if (!(error instanceof Error)) return error;
    if (!Object.keys(reservedUtxos.value).length) return error;
    const bchUnit = network.value === 'mainnet' ? 'BCH' : 'tBCH';
    // the shortfall carries the two amounts, in satoshis, alongside the message
    const shortfall = (error as { data?: { required?: bigint; available?: bigint } }).data;
    if (error.message.startsWith("Amount required was not met") && shortfall?.required !== undefined) {
      return new Error(t('store.errors.notEnoughSpendableBch', {
        needed: `${formatBchAmount(Number(shortfall.required), false, 8)} ${bchUnit}`,
        available: `${formatBchAmount(Number(shortfall.available ?? 0n), false, 8)} ${bchUnit}`,
      }));
    }
    const tokenSelectionFailures = [
      "Not enough token amount to send",
      "You do not have any token UTXOs with minting capability for specified category",
      "You do not have suitable token UTXOs to perform burn",
    ];
    if (tokenSelectionFailures.includes(error.message)) {
      return new Error(t('store.errors.notEnoughSpendableTokens'));
    }
    return error;
  }

  async function spendExplained<T>(makeTransaction: () => Promise<T>): Promise<T> {
    try {
      return await makeTransaction();
    } catch (error) {
      throw explainHeldBackCoins(error);
    }
  }

  // Spends one coin whole: a pool of only that coin, sent with sendMax, so no other coin joins
  // the transaction and no change returns. A reservation on the coin is dropped only once
  // broadcast, so a failure leaves the coin held rather than released into the next unrelated send.
  async function sendSingleCoin(utxo: Utxo, cashaddr: string) {
    const response = await wallet.value.sendMax(cashaddr, { utxoIds: [utxo] });
    // The coin is gone, so refresh before dropping the reservation: otherwise the spendable
    // pool still holds it and the max-amount refresh asks the server about a spent outpoint
    await updateWalletUtxos();
    const outpoint = outpointOf(utxo);
    if (outpoint in reservedUtxos.value) await dropReservation(outpoint);
    else await refreshMaxAmountToSend();
    return response;
  }

  const spend = {
    async send(requests: SendRequestType, options?: SpendOptions) {
      checkNoReservedUtxos(options);
      const spendConfig = createSpendConfig(options, await excludeReservedUtxos());
      return spendExplained(() => wallet.value.send(requests, spendConfig));
    },
    async sendMax(cashaddr: string, options?: SpendOptions) {
      checkNoReservedUtxos(options);
      const spendConfig = createSpendConfig(options, await excludeReservedUtxos());
      return spendExplained(() => wallet.value.sendMax(cashaddr, spendConfig));
    },
    // mainnet-js takes the first vout-0 BCH coin of the pool it is handed as the genesis input,
    // and that coin's txid becomes the category, so the picked coin goes at the front of the pool.
    async tokenGenesis(
      genesisInput: Utxo,
      genesisRequest: TokenGenesisRequest,
      sendRequests?: SendRequestType | SendRequestType[]
    ) {
      const outpoint = outpointOf(genesisInput);
      const spendable = spendableFromUtxos(await wallet.value.getUtxos(), reservedUtxos.value);
      const picked = spendable.find(utxo => outpointOf(utxo) === outpoint);
      // a coin spent elsewhere since it was picked would otherwise create a category nobody chose
      if (!picked || picked.vout !== 0 || picked.token) throw new Error(t('store.errors.genesisInputUnavailable'));
      const otherCoins = spendable.filter(utxo => outpointOf(utxo) !== outpoint);
      const pool = [picked, ...otherCoins];
      return spendExplained(() => wallet.value.tokenGenesis(genesisRequest, sendRequests, { utxoIds: pool }));
    },
    // tokenMint and tokenBurn discard an ensureUtxos passed here, using their own to locate the
    // token input; utxoIds still applies to everything else they select
    async tokenMint(
      category: string,
      mintRequests: TokenMintRequest | TokenMintRequest[],
      deductTokenAmount?: boolean,
      options?: SpendOptions
    ) {
      checkNoReservedUtxos(options);
      const spendConfig = createSpendConfig(options, await excludeReservedUtxos());
      return spendExplained(() => wallet.value.tokenMint(category, mintRequests, deductTokenAmount, spendConfig));
    },
    async tokenBurn(burnRequest: TokenBurnRequest, message?: string, options?: SpendOptions) {
      checkNoReservedUtxos(options);
      const spendConfig = createSpendConfig(options, await excludeReservedUtxos());
      return spendExplained(() => wallet.value.tokenBurn(burnRequest, message, spendConfig));
    },
    async getMaxAmountToSend(outputCount?: number) {
      const spendConfig = createSpendConfig(undefined, await excludeReservedUtxos()) ?? {};
      if (outputCount === undefined) return wallet.value.getMaxAmountToSend({ options: spendConfig });
      return wallet.value.getMaxAmountToSend({ outputCount, options: spendConfig });
    },

    // Every identity operation is this one spend: the old authhead in and the new authhead at
    // output 0, which is what continues the authchain. The coin is held back exactly so nothing
    // else reaches it, so this is the one path that spends past its own reservation.
    // The pool is the wallet's BCH coins plus the authhead, and only the token coins the operation
    // asked for: leaving the category's other coins out keeps a supply operation from sweeping the
    // circulating balance into itself as change.
    async spendAuthUtxo(authUtxo: Utxo, requests: SendRequestType, categoryUtxos: Utxo[] = []) {
      const spendable = spendableFromUtxos(await wallet.value.getUtxos(), reservedUtxos.value);
      const pool = [...spendable.filter(utxo => !utxo.token), authUtxo, ...categoryUtxos];
      const response = await spendExplained(() => wallet.value.send(requests, {
        utxoIds: pool,
        ensureUtxos: [authUtxo],
      }));
      await updateWalletUtxos();
      // the authhead has moved to a new outpoint, so its reservation has to follow it there
      await refreshIdentities();
      return response;
    },

  // Cancelling a pledge is this coin sent back to the wallet's own deposit address, which
    // makes the signed pledge the campaign holds unusable
    async releaseReservedCoin(utxo: Utxo) {
      if (!(outpointOf(utxo) in reservedUtxos.value)) throw new Error(t('store.errors.utxoNotReserved'));
      return sendSingleCoin(utxo, wallet.value.getDepositAddress());
    },

    // The user spending one chosen coin whole, frozen or not. A pledged coin is refused: the
    // campaign holds a signed pledge against it, so cancelling the pledge is its only release.
    // An 'auth' reserved coin passes deliberately, transferring an identity is this same spend.
    async sendUtxo(utxo: Utxo, cashaddr: string) {
      if (reservedUtxos.value[outpointOf(utxo)]?.reason === 'pledge') {
        throw new Error(t('store.errors.cannotSendPledgedUtxo'));
      }
      return sendSingleCoin(utxo, cashaddr);
    },
  };

  return {
    activeWalletName,
    availableWallets,
    displayView,
    _wallet, // the _wallet is the actual wallet object but this can be null
    wallet, // computed property to access the wallet, always non-null
    walletHasAddress,
    checkDappReservedInputs,
    balance, // everything held, including reserved coins
    spendableBalance, // balance minus reservedBalance
    reservedBalance,
    maxAmountToSend,
    walletUtxos,
    spendableUtxos,
    reservedUtxos,
    reservedWalletUtxos,
    reserveUtxo,
    dropReservation,
    utxoLabels,
    setUtxoLabel,
    spend, // the only route to the wallet's spending methods
    tokenList,
    filteredTokenList,
    walletHistory,
    isHistoryPartial,
    txNotes,
    setTxNote,
    addressMarks,
    addressLabels,
    currentAddressIndex,
    currentDepositAddress,
    currentTokenDepositAddress,
    markAddressUsed,
    unmarkAddressUsed,
    setAddressLabel,
    walletInitFailed,
    pendingTokenSearch,
    dappConnectionStoresInitDone,
    latestGithubRelease,
    network,
    explorerUrl,
    bcmrRegistries,
    cauldronPrices,
    cauldronPools,
    badgerLocks,
    tapswapListings,
    tapswapRegistries,
    hodlContracts,
    announcedAssetsError,
    exchangeRate,
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
    identityCategories,
    identities,
    identitiesResolving,
    unidentifiedGuarded,
    identitiesGuardedByKey,
    watchedAuthKeys,
    dismissedIdentities,
    unseenIdentities,
    unnamedAuthheads,
    unnameableAuthheads,
    identityPublicationTxids,
    identityHistories,
    fetchIdentityHistory,
    unnamedAuthheadCoins,
    removeUnnamedAuthhead,
    nameUnnamedAuthheads,
    markIdentitiesSeen,
    detectWalletIdentities,
    inspectCategory,
    addAuthKey,
    removeAuthKey,
    publicationChecks,
    publicationChecksRunning,
    checkPublications,
    checkTokenUtxosSpendable,
    refreshIdentities,
    scanForIdentities,
    addIdentity,
    listCreatedIdentity,
    removeIdentity,
    fetchTokenMetadata,
    fetchCauldronPricesForTokens,
    fetchWalletCauldronPools,
    fetchWalletBadgerLocks,
    fetchWalletAnnouncedAssets,
    toggleFavorite,
    toggleHidden,
    tokenIconUrl,
    loadExistingWallet
  }
})
