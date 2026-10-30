import { defineStore } from "pinia"
import { ref, shallowRef, reactive, computed, watch, toRaw } from 'vue'
import {
  HDWallet,
  TestNetHDWallet,
  BaseWallet,
  GAP_SIZE,
  DEPOSIT_BRANCH,
  CHANGE_BRANCH,
  Config,
  createFailoverProvider,
  createProvider,
  type FailoverTransportOptions,
  DefaultProvider,
  setGlobalProvider,
  deleteNamedWallet,
  getNamedWalletId,
  convert,
  ExchangeRate,
  BroadcastTimeoutError,
  InsufficientFundsError,
  UtxoNotAvailableError,
  type Utxo,
  type ElectrumNetworkProvider,
  type CancelFn,
  type HexHeaderI,
  type SendRequestType,
  type TokenGenesisRequest,
  type TokenMintRequest,
  type TokenBurnRequest,
} from "@cashonize/bch-wallet-lib"
import { IndexedDBProvider } from "@cashonize/bch-wallet-lib/indexeddb"
import {
  CurrencySymbols,
  type BcmrTokenMetadata,
  type TokenList,
  type WalletHistoryReturnType,
  type WalletType
} from "../interfaces/interfaces"
import { electrumWssUrl, gatewayUrl, getBalanceFromUtxos, loadWalletFromId, sameTokenList, STALE_TIP_SECONDS, staleTipHours, walletTypeFromWalletId } from "src/utils/utils"
import { electrumServersOf, saveLastGoodElectrumServer } from "src/utils/wallet/electrumServers"
import {
  fetchTokenMetadata as fetchTokenMetadataFromIndexer,
  fetchNftMetadata as fetchNftMetadataFromIndexer,
  tokenListFromUtxos,
  parseIndexerResponse,
  parseNftCommitment as parseNftCommitmentUtil,
} from "./storeUtils"
import { binToHex, hexToBin, lockingBytecodeToCashAddress, cashAddressToLockingBytecode } from "@bitauth/libauth"
import type { Bytes } from "src/utils/dapp/reservedInputs"
import { convertElectrumTokenData } from "src/utils/utils"
import { Notify } from "quasar";
import { useSettingsStore } from './settingsStore'
import { useIdentitiesStore } from "./identitiesStore"
import { useWalletconnectStore } from "./walletconnectStore"
import { useCashconnectStore } from "./cashconnectStore"
import { useWizardconnectStore } from "./wizardconnectStore"
import { ActionableError, displayAndLogError } from "src/utils/errorHandling"
import { broadcastErrorMessage, classifyBroadcastError } from "src/utils/wallet/broadcastErrors"
import { cachedFetch, isFreshLookup } from "src/utils/cacheUtils"
import { pruneDeletedWalletCaches, getAllWalletsWithNetworkInfo, type WalletInfo } from "src/utils/wallet/dbUtils"
import { appNetworkOf, appNetworks, libraryNetwork, storedAppNetwork, walletDbName, type AppNetwork } from "src/utils/wallet/networks"
import { removeEmptyChipnetCopy } from "src/utils/wallet/tiedWallets"
import { sharedRun } from "src/utils/concurrency"
import { fetchCauldronPrices, type CauldronPriceData } from "src/utils/defi/cauldronApi"
import {
  fetchCauldronPools,
  cauldronChainPublicKeyHashes,
  publicKeyHashFromAddress,
  type CauldronPool
} from "src/utils/defi/cauldronPools"
import { fetchBadgerLocks, type BadgerLock } from "src/utils/defi/badgersStake"
import { listingsFromHistory, fetchActiveListings, type TapswapListing } from "src/utils/defi/tapswapListings"
import { hodlContractsFromHistory, fetchHodlContractStates, type HodlContract } from "src/utils/defi/hodlContracts"
import { loadTxNotes, saveTxNote, removeTxNotes } from "src/utils/history/txNotes"
import { updateTransactionIndex, removeTransactionIndex, type ScannedTransaction } from "src/utils/history/transactionIndex"
import { mergeNewestPage } from "src/utils/history/historyMerge"
import { type DappActivityEntry, loadDappActivity, appendDappActivity, clearDappActivity, removeDappActivity, loadDappActivitySeen, saveDappActivitySeen } from "src/utils/dapp/dappActivity"
import {
  loadAddressMarks,
  saveAddressMark,
  deleteAddressMark,
  loadAddressLabels,
  saveAddressLabel,
  removeAddressManagementData,
  loadFrozenAddresses,
  saveFrozenAddress,
  deleteFrozenAddress,
  deriveFreshAddressIndex
} from "src/utils/wallet/addressManagement"
import {
  loadReservedUtxos,
  saveReservedOutpoint,
  deleteReservedOutpoint,
  removeReservedUtxos,
  spendableFromUtxos,
  reservedFromUtxos,
  withFrozenAddresses,
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
import { removeIdentityData } from "src/utils/tools/identityLists"
import { defaultWalletName } from './constants';
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global
const settingsStore = useSettingsStore()

const isDesktop = import.meta.env.QUASAR_ELECTRON_MODE;
const EXCHANGE_RATE_REFETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CAULDRON_REFETCH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
// Long enough for a slow but healthy handshake, a TLS setup on a poor cellular link. It also caps
// how long a silent connection is kept before the library replaces it, which is 10 s by default.
const ELECTRUM_CONNECT_TIMEOUT_MS = 15_000;
// Transactions of the history loaded at open and on each refresh, until the user asks for all
const HISTORY_PAGE = 100;

//-----------------------------------------------------------------------------
// bch-wallet-lib configuration
//-----------------------------------------------------------------------------
// All of it has to be applied before the first wallet is constructed. Wallet
// creation reads several of these at construction time, and an HD wallet starts
// address discovery straight away, so anything set later arrives too late.

Config.EnforceCashTokenReceiptAddresses = true;
// Also where an HD wallet's address cache lives, in the WalletCache database mainnet-js wrote;
// without it the cache would be in memory only and every open would rediscover the addresses
Config.UseIndexedDBCache = true;
BaseWallet.StorageProvider = IndexedDBProvider;

// The servers each network's mode may use, in the order they are tried
function electrumServers(network: AppNetwork) {
  return electrumServersOf(network, settingsStore.electrumMode[network], settingsStore.electrumServer[network]);
}

// Point the library's default electrum servers at the first server of each network's mode, for a
// global provider the library would make itself: the store sets its own as the global provider of
// each network (see selectedProviders). Without this the library falls back to its built-in
// servers, leaking the wallet's addresses to a server the user never selected, and under the
// single mode to a second server. Kept in sync with settings via a watch (see below).
function setDefaultElectrumServers() {
  for (const network of appNetworks) {
    DefaultProvider.servers[libraryNetwork(network)] = [electrumWssUrl(electrumServers(network)[0]!)];
  }
}
setDefaultElectrumServers();

// Pin the fee rate at 1 sat/byte instead of taking the server's blockchain.relayfee. The library
// never goes below 1 sat/byte whatever a server says, but trusts a higher rate up to its fixed cap
// of 10 sat/byte, which would let a server make every send pay up to ten times that.
Config.RelayFeePerByte = 1;


export const useStore = defineStore('store', () => {
  const displayView = ref(undefined as (number | undefined));
  const viewStack = reactive<number[]>([]);
  // Multi-wallet state
  const activeWalletName = ref(localStorage.getItem('activeWalletName') ?? defaultWalletName);
  const availableWallets = ref([] as WalletInfo[]);
  // The network the Add wallet view creates or imports on: mainnet, unless the developer settings
  // opened it for another
  const addWalletNetwork = ref<AppNetwork>('mainnet');
  // Set while a chipnet copy is being removed, here rather than in the settings view, which unmounts
  // when the removal leaves the copy: no wallet may be opened on another network meanwhile
  const removingChipnetCopy = ref(false);
  // Wallet State
  // _wallet holds the wallet object and is null until one is set.
  // The wallet's internals belong to bch-wallet-lib: it owns the key cache and the address
  // histories and mutates them behind its own references, including from callbacks holding the
  // wallet from before it reached this store. Vue cannot track that, so only swapping in
  // another wallet is reactive, nothing inside it is.
  const _wallet = shallowRef(null as (WalletType | null));
  const balance = ref(undefined as (bigint | undefined));
  const maxAmountToSend = ref(undefined as (bigint | undefined));
  const walletUtxos = ref(undefined as (Utxo[] | undefined));
  // Replaced whole by each load, never changed in place, so Vue need not proxy the thousands of
  // inputs and outputs a large history holds
  const walletHistory = shallowRef(undefined as (WalletHistoryReturnType | undefined));
  const isHistoryPartial = ref(false);
  // Every txid of the wallet's history, loaded or not, for what only asks whether a transaction is
  // the wallet's
  const walletTxids = shallowRef(new Set() as ReadonlySet<string>);
  // Private notes on the active wallet's transactions, keyed by txid (see utils/txNotes.ts)
  const txNotes = ref({} as Record<string, string>);
  // What the active wallet signed for dapps, newest first (see utils/dapp/dappActivity.ts)
  const dappActivity = ref([] as DappActivityEntry[]);
  const dappActivitySeenAt = ref(0);
  // what was signed since the log was last opened, counted on its entry points
  const unseenDappActivityCount = computed(() =>
    dappActivity.value.filter(entry => entry.time > dappActivitySeenAt.value).length);
  // The history labels a dapp transaction with the latest entry for its txid
  const dappActivityByTxid = computed(() => {
    const byTxid = new Map<string, DappActivityEntry>();
    for (const entry of dappActivity.value) {
      if (entry.txid && !byTxid.has(entry.txid)) byTxid.set(entry.txid, entry);
    }
    return byTxid;
  });
  // Receive addresses the user marked as used and address labels, keyed by cashaddr
  // (see utils/addressManagement.ts)
  const addressMarks = ref([] as string[]);
  const addressLabels = ref({} as Record<string, string>);
  // Coins held back from coin selection by a stored reservation, keyed by outpoint
  // (see utils/wallet/reservedUtxos.ts); reservedUtxos below adds the coins on frozen addresses
  const storedReservations = ref({} as ReservedUtxos);
  // HD addresses whose every coin is held back, the ones they receive later included
  const frozenAddresses = ref([] as string[]);
  // Private labels on the wallet's coins, keyed by outpoint (see utils/wallet/utxoLabels.ts)
  const utxoLabels = ref({} as UtxoLabels);
  const tokenList = ref(null as (TokenList | null))
  // Category a token payment request asks for, set when the user chooses to open it from
  // the wallet page. The token list narrows itself to it and clears it again.
  const pendingTokenSearch = ref(undefined as (undefined | string));
  // Address whose transactions the history narrows to, set from the addresses page
  const pendingHistorySearch = ref(undefined as (undefined | string));
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
  // An electrum subscription replays the current state as if it had just changed, inside the
  // subscribe call itself; set after that, so a callback that sees it is looking at a change that
  // came later
  const electrumSubscriptionsActive = ref(false as boolean)
  // Set when wallet initialization aborts (electrum connection failure or a thrown error),
  // so views can show an error state instead of a loading state that never resolves
  const walletInitFailed = ref(false as boolean)
  const latestGithubRelease = ref(undefined as undefined | string);

  // Computed properties
  const network = computed(() => appNetworkOf(wallet.value.network))
  const explorerUrl = computed(() => settingsStore.explorer[network.value]);

  // Access to the wallet without a null check at every call site: throws rather than hand out
  // null. Read-only, so replacing the wallet goes through _wallet.
  const wallet = computed(() => {
    if (!_wallet.value) throw new Error('No wallet set in global store');
    return _wallet.value
  })

  // Preferred over wallet.hasAddress in computed properties and templates: hasAddress reads the
  // HD address cache, which the library owns and Vue therefore does not track. Unlike a direct
  // call, this one is tracked, so callers re-run when the cache advances.
  function walletHasAddress(address: string) {
    // The read is the subscription, without it reactive callers never re-run. walletUtxos stands
    // in for the cache because the store assigns it right after the getUtxos() calls that grow it.
    void walletUtxos.value;
    return wallet.value.hasAddress(address);
  }

  // Everything held back, keyed by outpoint: the stored reservations and the coins currently on a
  // frozen address. Anything asking whether a coin is held reads this one.
  const reservedUtxos = computed(() => {
    return withFrozenAddresses(walletUtxos.value ?? [], storedReservations.value, frozenAddresses.value);
  })

  // For the dapp signing check, which reads the scripts a request's inputs spend
  const frozenLockingBytecodes = computed(() => frozenAddresses.value.flatMap(address => {
    const decoded = cashAddressToLockingBytecode(address);
    return typeof decoded === 'string' ? [] : [binToHex(decoded.bytecode)];
  }))

  // Filters a fresh getUtxos() read down to the coins the wallet may spend: the stored
  // reservations and the frozen addresses applied to that read rather than to walletUtxos,
  // which can trail the coins the read brought in
  function filterSpendableUtxos(utxos: Utxo[]): Utxo[] {
    return spendableFromUtxos(utxos, withFrozenAddresses(utxos, storedReservations.value, frozenAddresses.value));
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
  // empty when no indexer is configured for the network, which turns token metadata off
  const tokenMetadataIndexer = computed(() => settingsStore.tokenMetadataIndexer[network.value])
  // empty when no Chaingraph instance is configured for the network
  const chaingraph = computed(() => settingsStore.chaingraph[network.value])

  // The first unused receive address that is not skipped, within the seed-restore discovery
  // window; undefined for single-address wallets and when every address in that window is skipped
  // (see deriveFreshAddressIndex)
  function freshReceiveIndex(skippedAddresses: string[]) {
    const activeWallet = _wallet.value;
    if (!(activeWallet instanceof HDWallet)) return undefined;
    return deriveFreshAddressIndex(
      (index) => (activeWallet.rawHistory.get(DEPOSIT_BRANCH)?.[index]?.length ?? 0) > 0,
      (index) => activeWallet.walletCache.getByIndex(index, DEPOSIT_BRANCH).address,
      skippedAddresses,
      GAP_SIZE,
    );
  }

  // What the receive address skips: the frozen addresses, a payment to which could not be spent
  // from here, and the marked ones while marking is on
  function skippedReceiveAddresses() {
    if (!settingsStore.enableAddressMarking) return frozenAddresses.value;
    return [...addressMarks.value, ...frozenAddresses.value];
  }

  // Index of the receive address shown on the wallet page. For HD wallets this skips the marked
  // and frozen addresses; undefined for single-address wallets and when every address in the
  // discovery window is skipped, which marking and freezing refuse to bring about but another
  // open tab doing so at the same time still can
  const currentAddressIndex = computed(() => {
    // rawHistory and walletCache below sit outside Vue reactivity, walletUtxos is the
    // signal that they advanced (see walletHasAddress)
    void walletUtxos.value;
    // marks are kept but ignored while the setting is off, so with nothing frozen the wallet
    // hands out the same address it would have without either feature
    if (!settingsStore.enableAddressMarking && !frozenAddresses.value.length) return undefined;
    const index = freshReceiveIndex(skippedReceiveAddresses());
    if (index !== undefined || !settingsStore.enableAddressMarking) return index;
    // with every address in the window skipped, a marked one is still better than a frozen one
    return freshReceiveIndex(frozenAddresses.value);
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
      return tokenList.value.filter(token => !settingsStore.hiddenTokens.includes(token.category));
    }
    if (filter === 'favoritesOnly') {
      return tokenList.value.filter(token => settingsStore.featuredTokens.includes(token.category));
    }
    if (filter === 'hiddenOnly') {
      return tokenList.value.filter(token => settingsStore.hiddenTokens.includes(token.category));
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

  // Every coin the wallet held since its initialization, so a transaction spending one is its own
  // without fetching its inputs' parents. It only grows: a refresh can drop a spent coin before the
  // transaction that spent it arrives.
  const heldOutpoints = new Set<Outpoint>();
  watch(walletUtxos, utxos => {
    for (const utxo of utxos ?? []) heldOutpoints.add(outpointOf(utxo));
  }, { flush: 'sync' });

  // Lets the 'online' event listener retry an initialization aborted while offline
  let abortedInitOffline = false;
  // The notice stays up while offline, since the retry on reconnect needs no action from the user
  let dismissOfflineNotice: undefined | (() => void);
  function clearOfflineNotice() {
    dismissOfflineNotice?.();
    dismissOfflineNotice = undefined;
  }

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

  // The provider of each network's electrum servers, which fails over between them itself (the
  // library's createFailoverProvider). It is also the library's global provider of that network,
  // so a wallet constructed anywhere (loading, creating and importing, the derivation path scan,
  // the sweep) starts on it rather than being moved there after it subscribed. A failover keeps
  // the provider, so wallets follow it without a move. Wallet switches share it, and a mode or
  // server change replaces it; the replaced one is disconnected once no wallet is on it any more.
  const selectedProviders: Partial<Record<AppNetwork, { choice: string; provider: Promise<ElectrumNetworkProvider> }>> = {};
  const replacedProviders = new Set<ElectrumNetworkProvider>();
  // The server each network's provider is on, for the messages that name it
  const electrumServerInUse = reactive<Partial<Record<AppNetwork, string>>>({});

  // `fresh` makes a new one for an unchanged choice too, which connects only once it is used
  function providerForSelectedServer(network: AppNetwork, fresh = false): Promise<ElectrumNetworkProvider> {
    const mode = settingsStore.electrumMode[network];
    // keyed on the choice rather than the list, which a failover reorders under automatic
    const choice = `${mode} ${settingsStore.electrumServer[network]}`;
    const selected = selectedProviders[network];
    if (selected?.choice === choice && !fresh) return selected.provider;
    const servers = electrumServers(network);
    const urls = servers.map(electrumWssUrl);
    const options: FailoverTransportOptions = {
      connectTimeout: ELECTRUM_CONNECT_TIMEOUT_MS,
      onServerChange: (url) => {
        if (selectedProviders[network]?.provider !== provider) return;
        const server = servers[urls.indexOf(url)]!;
        electrumServerInUse[network] = server;
        if (mode === 'automatic') saveLastGoodElectrumServer(network, server);
      },
    };
    // a test network's hashrate is too erratic for a gap between blocks to say anything about the server
    if (network === 'mainnet') options.staleTipSeconds = STALE_TIP_SECONDS;
    const provider = createFailoverProvider(libraryNetwork(network), urls, options)
      .then((made) => {
        setGlobalProvider(libraryNetwork(network), made);
        return made;
      });
    selectedProviders[network] = { choice, provider };
    delete electrumServerInUse[network];
    // one that cannot be made is not kept, so the next call tries again; its rejection reaches
    // whoever awaits it, and is no unhandled rejection otherwise
    provider.catch(() => {
      if (selectedProviders[network]?.provider === provider) delete selectedProviders[network];
    });
    if (selected) selected.provider.then(retireProvider, () => {});
    return provider;
  }

  // The server in use, or before one connected the servers the mode may use
  function electrumServerName(network: AppNetwork) {
    return electrumServerInUse[network] ?? electrumServers(network).join(', ');
  }

  // The active wallet may still be on a replaced provider until initializeWallet moves it
  function retireProvider(provider: ElectrumNetworkProvider) {
    replacedProviders.add(provider);
    disconnectReplacedProviders();
  }
  function disconnectReplacedProviders() {
    for (const provider of replacedProviders) {
      if (_wallet.value?.provider === provider) continue;
      replacedProviders.delete(provider);
      provider.disconnect().catch(() => {});
    }
  }
  // made now, so that the first wallet constructed already finds them
  for (const network of appNetworks) void providerForSelectedServer(network);

  // Whether the library takes a server address, checked before a setting changes to it; the
  // provider made for the check connects to nothing
  async function validateElectrumServer(network: AppNetwork, server: string) {
    await createProvider(libraryNetwork(network), electrumWssUrl(server));
  }

  // The provider of the selected server of the wallet's network, which initializeWallet puts the
  // wallet on (a wallet constructed after the server was selected is on it already)
  let walletProvider: ElectrumNetworkProvider | undefined;
  async function selectElectrumProvider(walletNetwork: WalletType['network']) {
    walletProvider = await providerForSelectedServer(appNetworkOf(walletNetwork));
  }

  // setWallet is a simple wrapper "set" function for the internal _wallet in the store.
  // It makes the provider for the configured electrum server of the wallet's network, which
  // initializeWallet() moves the wallet onto when it connects and fetches the initial data.
  async function setWallet(newWallet: WalletType){
    const identitiesStore = useIdentitiesStore();
    await selectElectrumProvider(newWallet.network);
    const previousNetwork = _wallet.value?.network;
    _wallet.value?.stop().catch(() => {});
    _wallet.value = newWallet;
    // the network left keeps no connection open: a fresh provider for its server connects once used
    if (previousNetwork && previousNetwork !== newWallet.network) {
      void providerForSelectedServer(appNetworkOf(previousNetwork), true);
    }
    const newNetwork = appNetworkOf(newWallet.network);
    txNotes.value = loadTxNotes(newNetwork, newWallet.name);
    dappActivity.value = loadDappActivity(newNetwork, newWallet.name);
    dappActivitySeenAt.value = loadDappActivitySeen(newNetwork, newWallet.name);
    addressMarks.value = loadAddressMarks(newNetwork, newWallet.name);
    addressLabels.value = loadAddressLabels(newNetwork, newWallet.name);
    storedReservations.value = loadReservedUtxos(newNetwork, newWallet.name);
    frozenAddresses.value = loadFrozenAddresses(newNetwork, newWallet.name);
    utxoLabels.value = loadUtxoLabels(newNetwork, newWallet.name);
    identitiesStore.loadForWallet(newNetwork, newWallet.name);
  }

  // A wallet initialization this counter has moved past is stale, and its work is dropped. The
  // identities store's passes outlive a wallet switch just as easily: they note the token when
  // they start and ask before every write.
  function currentInitializationToken() {
    return currentInitialization;
  }
  function walletSwitchedSince(started: number) {
    return started !== currentInitialization;
  }

  function setTxNote(txid: string, note: string) {
    txNotes.value = saveTxNote(network.value, wallet.value.name, txid, note);
  }

  function recordDappActivity(entry: Omit<DappActivityEntry, 'time'>) {
    dappActivity.value = appendDappActivity(network.value, wallet.value.name, { time: Date.now(), ...entry });
  }
  function markDappActivitySeen() {
    dappActivitySeenAt.value = Date.now();
    saveDappActivitySeen(network.value, wallet.value.name, dappActivitySeenAt.value);
  }
  function clearActiveDappActivity() {
    clearDappActivity(network.value, wallet.value.name);
    dappActivity.value = [];
  }

  // Mark a receive address as used so a fresh address is handed out, for when the user shared
  // an address but no payment has arrived yet. Refused when marking would leave no fresh address
  // inside the seed-restore discovery window; receiving a payment extends the window again.
  function markAddressUsed(address: string) {
    const activeWallet = wallet.value;
    if (!(activeWallet instanceof HDWallet)) return;
    const freshIndexAfterMark = freshReceiveIndex([...addressMarks.value, ...frozenAddresses.value, address]);
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

  // A frozen address keeps receiving, but every coin on it is held back like a reserved one,
  // including the ones it receives later. Like marking, freezing refuses to leave no fresh receive
  // address in the discovery window; marks are left out of that count, since the receive address
  // falls back to a marked one before it would to a frozen one. Returns whether it was frozen.
  async function freezeAddress(address: string) {
    const freshBefore = freshReceiveIndex(frozenAddresses.value);
    const freshAfter = freshReceiveIndex([...frozenAddresses.value, address]);
    if (freshBefore !== undefined && freshAfter === undefined) {
      Notify.create({
        message: t('addressManagement.freezeLimitNotify'),
        icon: 'warning',
        color: "red"
      })
      return false;
    }
    frozenAddresses.value = saveFrozenAddress(network.value, wallet.value.name, address);
    updateTokenList();
    await refreshMaxAmountToSend();
    return true;
  }

  async function unfreezeAddress(address: string) {
    frozenAddresses.value = deleteFrozenAddress(network.value, wallet.value.name, address);
    updateTokenList();
    await refreshMaxAmountToSend();
  }

  function setAddressLabel(address: string, label: string) {
    addressLabels.value = saveAddressLabel(network.value, wallet.value.name, address, label);
  }

  function setUtxoLabel(outpoint: string, label: string) {
    utxoLabels.value = saveUtxoLabel(network.value, wallet.value.name, outpoint, label);
  }

  async function initializeWallet() {
    const identitiesStore = useIdentitiesStore();
    if(!_wallet.value) throw new Error("No Wallet set in global store")
    currentInitialization++;
    console.log(`Wallet initialization #${currentInitialization}`);
    // Capture value for closures to detect stale async operations
    const initialization = currentInitialization;

    electrumSubscriptionsActive.value = false;
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
      console.warn("Device offline, wallet initialization deferred until the connection returns");
      dismissOfflineNotice ??= Notify.create({
        message: t('store.errors.deviceOffline'),
        icon: 'wifi_off',
        color: 'grey-7',
        timeout: 0,
      });
      return;
    }
    clearOfflineNotice();

    try {
      // // Kick off exchange rate fetch immediately, so it's available as soon as possible for fiat balance display during initialization
      void fetchExchangeRate();

      // Started here and awaited further down, so the dapp inits run alongside the connect. The
      // catch is attached in the same expression, so a failed connect never surfaces as an
      // unhandled rejection; it lands in walletInitFailed and the offline path instead.
      const provider = walletProvider;
      if (!provider) throw new Error("No electrum provider selected for the wallet");
      const activeWallet = wallet.value;
      const electrumConnectionPromise = activeWallet.setProvider(provider)
        .then(() => {
          disconnectReplacedProviders();
          return true;
        })
        .catch(error => {
          // a server change since replaced this provider, and the move to the newer one reports
          if (provider !== walletProvider) return false;
          const server = electrumServerName(network.value);
          displayAndLogError(new Error(t('store.errors.unableToConnectElectrum', { server })))
          // still log the original error for debugging
          console.error("Electrum connect error:", error)
          return false;
        });
      // WizardConnect initialization is synchronous (key derivation only, connections are fire-and-forget)
      initializeWizardConnect();
      // The relay inits are not awaited: wallet data does not depend on them and neither has a
      // timeout. Code that needs the dapp stores waits on dappConnectionStoresInitDone instead
      void initializeWalletConnect();
      void initializeCashConnect();
      const electrumConnected = await electrumConnectionPromise;
      if (initialization !== currentInitialization) return;
      if (!electrumConnected) {
        walletInitFailed.value = true;
        return;
      }
      // Fetch wallet utxos first, this result will be used in consecutive calls to avoid duplicate getUtxos() calls.
      // For HD wallets this also awaits address discovery, which primes per-address utxos and history,
      // and rejects if a subscription or first fetch of it failed.
      console.time('fetch wallet utxos');
      const walletAddressUtxos = await wallet.value.getUtxos()
      console.timeEnd('fetch wallet utxos');
      if (initialization !== currentInitialization) return;
      const balanceSats = getBalanceFromUtxos(walletAddressUtxos)
      // Fetch fiat balance and max amount to send in parallel
      // 'getMaxAmountToSend' combines multiple fetches (blockheight, relayfee, price) so is a bit slower
      console.time('fetch fiat balance & max amount to send');
      const promiseMaxAmountToSend = wallet.value.getMaxAmountToSend(spendExclusions());
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
      // From here the subscription callbacks update state; the metadata and history still loading
      // are enrichment an update can run alongside
      electrumSubscriptionsActive.value = true;
      // fire-and-forget getLatestGithubRelease promise for desktop platform
      if(isDesktop) void getLatestGithubRelease()
      console.time('fetch token metadata and initial history');
      await Promise.all([
        fetchTokenMetadata(allTokenList.value ?? [], false),
        updateWalletHistory({ count: HISTORY_PAGE }),
      ]);
      console.timeEnd('fetch token metadata and initial history');
      if (initialization !== currentInitialization) return;
      // fetch Cauldron prices as fire-and-forget (non-critical)
      void fetchCauldronPricesForTokens();
      startRefetchIntervals();
      // the identities come last and on their own: not critical to the wallet loading, and a
      // lookup they need failing is theirs to report, not a failed wallet
      void identitiesStore.runChecksOnOpen();
    } catch (error) {
      // A stale initialization must not flag the newer one as failed
      if (initialization === currentInitialization) walletInitFailed.value = true;
      displayAndLogError(error);
    }
  }

  // A wallet constructed while offline recovers on its own: its next read subscribes what
  // failed again, so retrying is initializing it again
  async function retryInitializationAfterOffline() {
    try {
      await initializeWallet();
    } catch (error) {
      displayAndLogError(error);
    }
  }

  // Only offline-aborted inits are retried: other init failures already ran their
  // dapp inits, so retrying would register duplicate callbacks
  addEventListener('online', () => {
    clearOfflineNotice();
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
    // Capture initialization so subscription callbacks become no-ops after a wallet/network switch
    const initialization = currentInitialization;

    // The callbacks are async: the library reports a callback's rejection to console.error and
    // goes on watching
    cancelWatchBchtxs = await wallet.value.watchBalance(
      async (newBalance) => {
        if (initialization !== currentInitialization) return;
        // Compute oldBalance including bch on token utxos
        // to match way newBalance is calculated in watchBalance
        const oldBalance = walletUtxos.value?.reduce((acc, utxo) => acc + utxo.satoshis, BigInt(0));
        // explicit undefined check because 0n is falsy: a truthiness check would freeze
        // an empty wallet receiving its first funds and hide a wallet drained to zero
        if(oldBalance !== undefined && electrumSubscriptionsActive.value){
          // fire-and-forget so the notification (which may fetch a fiat rate) never
          // delays or blocks the state update below
          if(oldBalance < newBalance) void showReceivedBchNotification(newBalance - oldBalance);
          // update state (skipped on the initial trigger via the electrumSubscriptionsActive check)
          const walletAddressUtxos = await wallet.value.getUtxos();
          // update balance with the amount on bch-only utxos
          const balanceSats = getBalanceFromUtxos(walletAddressUtxos)
          balance.value = balanceSats;
          walletUtxos.value = walletAddressUtxos;
          void updateWalletHistory();
          await refreshMaxAmountToSend();
        }
      }
    );
    cancelWatchTokenTxs = await wallet.value.watchTokenTransactions(
      async (tx) => {
        if (initialization !== currentInitialization) return;
        const receivedTokenOutputs = tx.vout.filter(voutElem =>
          voutElem.tokenData && voutElem.scriptPubKey.addresses?.[0] &&
          wallet.value.hasAddress(voutElem.scriptPubKey.addresses[0])
        );
        const previousTokenList = tokenList.value;
        const listNewTokens:TokenList = []
        // User-sent txs produce token change outputs that trigger this subscription, skip notification for those
        const isUserInitiatedTx = tx.vin.some(input => heldOutpoints.has(outpointOf(input)));
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
      }
    );
    cancelWatchBlocks = await wallet.value.watchBlocks(header => {
      if (initialization !== currentInitialization) return;
      currentBlockHeight.value = header.height;
      // chipnet's hashrate is too erratic for a gap between blocks to say anything about the server
      if (network.value === 'mainnet') warnIfServerTipStale(header);
    }, false);
  }

  // Checked only on a tip the server delivers, which it does on every connect and reconnect, so a
  // connection that merely went quiet in a background tab cannot raise it
  let dismissStaleServerWarning: undefined | (() => void);
  function warnIfServerTipStale(header: HexHeaderI) {
    const hoursBehind = staleTipHours(header);
    if (hoursBehind === undefined) {
      dismissStaleServerWarning?.();
      dismissStaleServerWarning = undefined;
      return;
    }
    if (dismissStaleServerWarning) return;
    console.warn(`Electrum server tip at height ${header.height} is ${hoursBehind} hours old`);
    dismissStaleServerWarning = Notify.create({
      message: t('store.errors.staleElectrumServer', { server: electrumServerName('mainnet'), hours: hoursBehind }),
      icon: 'warning',
      color: 'red',
      timeout: 0,
      actions: [{ icon: 'close', color: 'white', round: true }],
    });
  }

  async function resetWalletState({ resetDappConnections = true } = {}){
    // Bump the initialization counter before anything else, so the fetches already in flight
    // become no-ops. Without it, a reply arriving late from the old wallet or server would
    // repopulate the state cleared below.
    currentInitialization++;
    viewStack.length = 0;
    electrumSubscriptionsActive.value = false;
    walletInitFailed.value = false;

    // Stop the intervals and clear the state before the awaits below, so the views do not go on
    // showing the old wallet's balance and history for as long as cancelling takes.
    stopRefetchIntervals();
    balance.value = undefined;
    maxAmountToSend.value = undefined;
    walletUtxos.value = undefined;
    heldOutpoints.clear();
    // The reservations and frozen addresses stay: a wallet switch replaces them in setWallet, and an
    // electrum server change keeps the same wallet, which would otherwise be left spending them
    pendingTokenSearch.value = undefined;
    pendingHistorySearch.value = undefined;
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
    walletTxids.value = new Set();
    currentBlockHeight.value = undefined;
    dismissStaleServerWarning?.();
    dismissStaleServerWarning = undefined;

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
  async function loadExistingWallet(walletName: string, network: AppNetwork): Promise<WalletType> {
    const walletId = await getNamedWalletId(walletName, walletDbName(network));
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
    network: AppNetwork,
    awaitWalletInitialization: boolean = false
  ){
    await resetWalletState();
    await setWallet(newWallet);
    if (awaitWalletInitialization) {
      await initializeWallet();
    } else {
      // fire-and-forget promise does not wait on full wallet initialization
      void initializeWallet();
    }
    localStorage.setItem('network', network);
    changeView(1);
  }

  // Opens the active wallet on the other network, which only older wallets have a copy on; resets
  // all wallet state. Returns whether it did: a wallet that is not there is left as it is, and no
  // wallet changes network while a chipnet copy is being removed.
  async function changeNetwork(
    newNetwork: AppNetwork,
    awaitWalletInitialization: boolean = false
  ): Promise<boolean> {
    if (removingChipnetCopy.value) {
      displayAndLogError(new Error(t('store.errors.chipnetCopyRemovalRunning')));
      return false;
    }
    return openActiveWalletOn(newNetwork, awaitWalletInitialization);
  }

  async function openActiveWalletOn(newNetwork: AppNetwork, awaitWalletInitialization: boolean): Promise<boolean> {
    // Load the wallet on the new network first: if it does not exist there, this throws and the
    // current wallet state is left untouched
    let newWallet: WalletType;
    try {
      newWallet = await loadExistingWallet(activeWalletName.value, newNetwork);
    } catch (error) {
      displayAndLogError(error);
      return false;
    }
    await activateWallet(newWallet, newNetwork, awaitWalletInitialization);
    return true;
  }

  interface SwitchWalletResult {
    success: true;
    networkChanged?: AppNetwork; // Set if network was changed to accommodate wallet
  }

  async function switchWallet(walletName: string): Promise<SwitchWalletResult> {
    // Get the current network from localStorage (default to mainnet)
    const currentNetwork = storedAppNetwork();

    // The network follows the wallet: it opens on its own network, mainnet for an older wallet
    // that also has its chipnet copy, which opens only from the developer settings
    // (availableWallets may be stale, loadExistingWallet below re-checks IndexedDB)
    let targetNetwork = currentNetwork;
    const walletInfo = availableWallets.value.find(w => w.name === walletName);
    if (walletInfo?.networks[0]) {
      targetNetwork = walletInfo.networks[0];
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
    // Delete from every network's database, each with its HD wallet's cached keys
    for (const network of appNetworks) {
      await deleteNamedWallet(walletName, walletDbName(network));
    }
    removeTxNotes(walletName);
    removeTransactionIndex(walletName);
    removeDappActivity(walletName);
    removeAddressManagementData(walletName);
    removeReservedUtxos(walletName);
    removeUtxoLabels(walletName);
    removePledges(walletName);
    removeIdentityData(walletName);
    settingsStore.clearWalletSettings(walletName);
    // Refresh the available wallets list
    await refreshAvailableWallets();
    // Also deletes the cached keys of wallets deleted before deleteNamedWallet cleared them.
    // The wallet is already gone by now, so a failure here is not a failed deletion.
    try {
      await pruneDeletedWalletCaches();
    } catch (error) {
      console.error(error);
      Notify.create({
        message: t('store.errors.cachedKeysNotCleared'),
        icon: 'warning',
        color: "red"
      })
    }
  }

  // Removes the chipnet copy of an older wallet that holds no coins (removeEmptyChipnetCopy checks
  // it again before deleting), leaving the wallet on mainnet only. Returns false, having removed
  // nothing, when another removal is running or the copy in use could not be left (which shows
  // why). The guard is set before anything else, so no wallet changes network from the first step
  // on. The copy's chipnet notes, labels and the like stay in localStorage: no other wallet can
  // take the name while the mainnet one has it, and deleteWallet removes them with it.
  async function removeChipnetCopy(walletName: string, checkedChipnetId: string): Promise<boolean> {
    if (removingChipnetCopy.value) return false;
    removingChipnetCopy.value = true;
    try {
      // the copy in use is left first, so the wallet open is never a deleted row
      if (walletName === activeWalletName.value && network.value === 'chipnet') {
        if (!await openActiveWalletOn('mainnet', true)) return false;
      }
      await removeEmptyChipnetCopy(walletName, checkedChipnetId);
    } finally {
      removingChipnetCopy.value = false;
      await refreshAvailableWallets();
    }
    return true;
  }

  async function initializeWalletConnect() {
    try {
      const walletconnectStore = useWalletconnectStore()
      await walletconnectStore.initweb3wallet();

      // Setup network change callback to disconnect all sessions.
      networkChangeCallbacks.push(async () => {
        const sessions = walletconnectStore.web3wallet?.getActiveSessions();
        if(!sessions) return

        // deleteSession instead of raw disconnectSession so a single zombie session can't throw
        // and abort disconnecting the remaining sessions; all at once, so a stale relay costs
        // the switch one deleteSession timeout rather than one per session
        await Promise.allSettled(
          Object.values(sessions).map(session => walletconnectStore.deleteSession(session.topic))
        );
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

  // A refresh that fails leaves the list one update behind, not wrong for long: the next
  // notification or read fetches again, and a spend from coins already spent is refused by the
  // library. It runs after every send, so a failure is logged rather than shown over a success.
  async function updateWalletUtxos() {
    try {
      walletUtxos.value = await wallet.value.getUtxos();
      updateTokenList()
    } catch(error) {
      console.error(t('store.errors.errorFetchingUtxos'), error)
    }
  }

  let historyRequestId = 0;
  // Categories already queried for history metadata this session, so categories without
  // a BCMR record aren't re-queried on every history refresh (cachedFetch only caches successful lookups)
  let queriedHistoryCategories: string[] = [];
  // Without a count, a refresh of what is loaded: the newest page, merged into the full history once
  // that is loaded; the refreshes of a send or receive, two or three per event, share one load
  function updateWalletHistory({ count }: { count?: number } = {}) {
    if (count === undefined) return historyLoad.run({ again: true });
    return fetchWalletHistory(count);
  }

  // Fetches wallet history via the library's getHistory(), which decodes every transaction and its
  // prevouts, so the full history is loaded only when asked for and then kept up to date page-wise
  async function fetchWalletHistory(count: number, { merge = false } = {}) {
    const requestId = ++historyRequestId;
    try {
      const initialization = currentInitialization;
      // read first, so a transaction arriving during the load lengthens the history, not the txids
      const rawHistory = await wallet.value.getRawHistory();
      const history = await wallet.value.getHistory({ count });
      if (initialization !== currentInitialization) return;
      if (requestId !== historyRequestId) return; // newer request in-flight, discard stale result
      const historyTxids = new Set(rawHistory.map(tx => tx.tx_hash));
      let applied = history;
      if (merge) applied = mergeNewestPage(walletHistory.value ?? [], history, historyTxids);
      walletHistory.value = applied;
      walletTxids.value = historyTxids;
      historyShownIn = initialization;
      if (count < 0) allHistoryLoaded = initialization;
      // a full load is complete by definition, and a merged one is kept so until the next open
      isHistoryPartial.value = !merge && count > 0 && history.length < rawHistory.length;
      // Fetch metadata for history tokens no longer in the wallet, so their names, icons
      // and decimals still display. Fire-and-forget: history renders right away and the
      // metadata fills in reactively. Held tokens are left to the wallet's own fetch: while that is
      // loading, this category-only answer could land after it and drop their NFTs' metadata.
      const missingCategories: string[] = [];
      for (const tx of history) {
        for (const tokenChange of tx.tokenAmountChanges) {
          const category = tokenChange.category;
          if (bcmrRegistries.value?.[category] || queriedHistoryCategories.includes(category)) continue;
          if (allTokenList.value?.some(token => token.category === category)) continue;
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

  // The initializations a history was shown in, and the full one asked for and loaded in: asked, a
  // load is of all of it; loaded, a refresh fetches the newest page and merges it in
  let historyShownIn = -1;
  let allHistoryAsked = -1;
  let allHistoryLoaded = -1;
  const loadingFullHistory = ref(false);
  // One load at a time per wallet, so a refresh of the page never overtakes the full load
  const historyLoad = sharedRun(() => {
    if (allHistoryLoaded === currentInitialization) return fetchWalletHistory(HISTORY_PAGE, { merge: true });
    if (allHistoryAsked === currentInitialization) return fetchWalletHistory(-1);
    return fetchWalletHistory(HISTORY_PAGE);
  }, () => currentInitialization);
  async function loadAllHistory() {
    allHistoryAsked = currentInitialization;
    loadingFullHistory.value = true;
    try {
      await historyLoad.run({ again: true });
    } finally {
      loadingFullHistory.value = false;
    }
  }
  // The full history loads once per wallet session, when the user first needs it (the history view,
  // the token picker), after the newest page is shown
  function ensureFullHistory() {
    if (historyShownIn !== currentInitialization || allHistoryAsked === currentInitialization) return;
    void loadAllHistory();
  }
  // a watch rather than the view mounting, as the views stay alive across a wallet switch; on each
  // history shown, so a new wallet's or initialization's history view loads its own in full
  watch([() => displayView.value === 3, walletHistory], ([historyView]) => {
    if (historyView) ensureFullHistory();
  });
  // The transactions the wallet's features look for in its history, the identity markers and the
  // TapSwap and hodl announcements, brought up to the history first; one update at a time per wallet
  const transactionIndex = sharedRun(
    () => updateTransactionIndex(wallet.value, network.value, wallet.value.name),
    () => currentInitialization,
  );
  function indexedTransactions() {
    return transactionIndex.run();
  }

  function updateTokenList() {
    // Uses the walletUtxos to create a tokenList
    if(!walletUtxos.value) return // should never happen
    const newTokenList = tokenListFromUtxos(walletUtxos.value, reservedUtxos.value);
    // sort tokenList with featuredTokens first
    sortTokenList(newTokenList);
  }

  // The tokens the wallet holds, held back coins included, the way balance counts BCH: what the
  // portfolio values and the metadata fetch covers, where tokenList counts only what can be spent
  const allTokenList = computed(() => walletUtxos.value ? tokenListFromUtxos(walletUtxos.value) : null);

  function sortTokenList(unsortedTokenList: TokenList) {
    // order the featuredTokenList according to the order in the settingStore
    const featuredTokenList: TokenList = []
    for(const featuredToken of settingsStore.featuredTokens){
      // a category holding both fungibles and NFTs has an entry for each, keep both
      const featuredTokenItems = unsortedTokenList.filter(token => token.category === featuredToken);
      featuredTokenList.push(...featuredTokenItems)
    }
    const otherTokenList = unsortedTokenList.filter(token => !settingsStore.featuredTokens.includes(token.category));

    const sortedTokenList = [...featuredTokenList, ...otherTokenList];
    // assigned only when it changed, so what watches it does not rerun on the refreshes of the
    // wallet's coins that change nothing in it, several per send; read raw to skip the proxies
    if (tokenList.value && sameTokenList(toRaw(tokenList.value), sortedTokenList)) return;
    tokenList.value = sortedTokenList;
  }

  // Fetch token metadata from BCMR indexer
  async function fetchTokenMetadata(tokenList: TokenList, fetchNftInfo: boolean) {
    const initialization = currentInitialization;
    const registries = await fetchTokenMetadataFromIndexer(tokenList, fetchNftInfo, tokenMetadataIndexer.value, bcmrRegistries.value);
    if (initialization !== currentInitialization) return;
    // Merged rather than assigned: two fetches that started while the registries were still
    // undefined each built their own object, and the second to land would replace the first's
    bcmrRegistries.value = Object.assign(bcmrRegistries.value ?? {}, registries);
  }

  // Fetch BCH exchange rate for fiat display
  // the library has its own ~4 min TTL cache but we store the rate centrally for reactive access
  async function fetchExchangeRate() {
    try {
      const initialization = currentInitialization;
      const currency = settingsStore.currency;
      const quote = await ExchangeRate.getQuote(currency, { staleOnError: true });
      // discard a rate that no longer belongs: the state may have been reset, or the user may
      // have switched currency, which starts a second fetch that can resolve before this one
      if (initialization !== currentInitialization || currency !== settingsStore.currency) return;
      exchangeRate.value = quote.rate;
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

    // priced for the portfolio, which values held back coins too
    const fungibleTokens = allTokenList.value?.filter(token => 'amount' in token) ?? [];
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
    for (const branch of [DEPOSIT_BRANCH, CHANGE_BRANCH]) {
      const rawHistory = activeWallet.rawHistory.get(branch) ?? [];
      const lastIndex = (activeWallet.indices.get(branch) ?? 0) + GAP_SIZE;
      for (let i = 0; i <= lastIndex; i++) {
        if (!rawHistory[i]?.length) continue;
        const publicKeyHash = binToHex(activeWallet.walletCache.getByIndex(i, branch).publicKeyHash);
        publicKeyHashes.push(publicKeyHash);
      }
    }
    publicKeyHashes.push(
      ...cauldronChainPublicKeyHashes(activeWallet.mnemonic, activeWallet.derivation, GAP_SIZE)
    );
    return publicKeyHashes;
  }

  // a revisit within a minute, for the same wallet, addresses and coins, reuses the last lookup
  const DEFI_LOOKUP_TTL_MS = 60_000;
  let cauldronPoolsLookup: { key: string, at: number } | undefined;
  let badgerLocksLookup: { key: string, at: number } | undefined;
  function defiLookupKey(ownerPkhs: string[]) {
    const coins = (walletUtxos.value ?? []).map(outpointOf).sort();
    return `${currentInitialization}:${ownerPkhs.join()}:${coins.join()}`;
  }

  // Find the Cauldron liquidity pools the wallet owns. Pools are not held as a token or an NFT,
  // they live at the pool contract address derived from the owner's public key hash, so this is
  // a UTXO lookup per wallet address. Only the portfolio view shows them, so it drives the fetch.
  async function fetchWalletCauldronPools() {
    // the portfolio view can ask before the wallet is set, the retry comes with the token list
    if (!_wallet.value) return;
    try {
      const ownerPkhs = walletPublicKeyHashes();
      const lookupKey = defiLookupKey(ownerPkhs);
      if (cauldronPools.value && isFreshLookup(cauldronPoolsLookup, lookupKey, DEFI_LOOKUP_TTL_MS)) return;
      const initialization = currentInitialization;
      const pools = await fetchCauldronPools(wallet.value.provider, ownerPkhs, wallet.value.networkPrefix);
      if (initialization !== currentInitialization) return;
      cauldronPools.value = pools;
      cauldronPoolsLookup = { key: lookupKey, at: Date.now() };

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
      const ownerPkhs = walletPublicKeyHashes();
      const lookupKey = defiLookupKey(ownerPkhs);
      if (badgerLocks.value && isFreshLookup(badgerLocksLookup, lookupKey, DEFI_LOOKUP_TTL_MS)) return;
      const initialization = currentInitialization;
      const locks = await fetchBadgerLocks(wallet.value.provider, ownerPkhs);
      if (initialization !== currentInitialization) return;
      badgerLocks.value = locks;
      badgerLocksLookup = { key: lookupKey, at: Date.now() };
    } catch (error) {
      // swallowed like the Cauldron lookup, so one unreachable request does not keep the
      // portfolio from rendering everything else
      console.error("Failed to look up Badgers.cash locks:", error);
      badgerLocks.value ??= [];
    }
  }

  // Find the wallet's TapSwap listings and hodl contracts. Both are held by contracts, so the
  // wallet holds nothing that represents them, and both are announced by an OP_RETURN on a
  // transaction the wallet funded, so both are read off the wallet's own transactions. Only the
  // portfolio view shows them, so it drives the fetch. Both protocols are mainnet only. Each is
  // null while its first lookup runs, and the two land independently.
  async function fetchWalletAnnouncedAssets() {
    if (!_wallet.value) return;
    if (network.value !== 'mainnet') {
      tapswapListings.value = [];
      hodlContracts.value = [];
      return;
    }
    // after a failure both are looked up anew, and show as loading again until they land
    if (announcedAssetsError.value) {
      tapswapListings.value = null;
      hodlContracts.value = null;
    }
    announcedAssetsError.value = undefined;
    const initialization = currentInitialization;

    async function lookUpListings(announcements: ScannedTransaction[], ownerPkhs: string[]) {
      const listings = await fetchActiveListings(wallet.value.provider, listingsFromHistory(announcements, ownerPkhs, wallet.value.networkPrefix));
      if (initialization !== currentInitialization) return;
      tapswapListings.value = listings;
      // names and icons fill in after the rows: nothing waits on them
      void fetchListingMetadata(listings);
    }
    async function lookUpHodlContracts(announcements: ScannedTransaction[], ownerPkhs: string[]) {
      const contracts = await fetchHodlContractStates(wallet.value.provider, hodlContractsFromHistory(announcements, ownerPkhs));
      if (initialization !== currentInitialization) return;
      hodlContracts.value = contracts;
    }
    // NFT listings fetch their NFT-specific metadata (name, icon), which carries the collection
    // metadata with it; fungible listings fetch the category metadata. The fetches merge into
    // tapswapRegistries in place.
    async function fetchListingMetadata(listings: TapswapListing[]) {
      const fetches: Promise<unknown>[] = [];
      // several listings of one token or NFT ask once, now that the fetches no longer wait on each other
      const requested = new Set<string>();
      for (const listing of listings) {
        const key = `${listing.category}:${listing.commitment ?? 'fungible'}`;
        if (requested.has(key)) continue;
        requested.add(key);
        if (listing.commitment !== undefined) {
          if (tapswapRegistries.value[listing.category]?.nfts?.[listing.commitment]) continue;
          fetches.push(fetchNftMetadataFromIndexer(listing.category, listing.commitment, tokenMetadataIndexer.value, tapswapRegistries.value));
          continue;
        }
        if (tapswapRegistries.value[listing.category]) continue;
        fetches.push(fetchTokenMetadataFromIndexer(
          [{ category: listing.category, amount: listing.tokenAmount }], false, tokenMetadataIndexer.value, tapswapRegistries.value
        ));
      }
      const results = await Promise.allSettled(fetches);
      for (const result of results) {
        if (result.status === 'rejected') console.error("Failed to fetch TapSwap listing metadata:", result.reason);
      }
    }

    try {
      const ownerPkhs = walletPublicKeyHashes();
      const { announcements } = await indexedTransactions();
      if (initialization !== currentInitialization) return;
      await Promise.all([
        lookUpListings(announcements, ownerPkhs),
        lookUpHodlContracts(announcements, ownerPkhs),
      ]);
    } catch (error) {
      // shown inline in the portfolio view rather than toasted: this fetch re-runs on
      // every portfolio entry, so an unreachable server would toast on each visit
      console.error("Failed to look up TapSwap listings and hodl contracts:", error);
      // a lookup cut off by a wallet switch is no failure of the wallet now open
      if (initialization !== currentInitialization) return;
      announcedAssetsError.value = t('portfolio.announcedAssetsLoadingFailed');
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

  // Refetch exchange rate when user changes currency; the old currency's rate is dropped at once,
  // so no display pairs it with the new currency's symbol meanwhile
  watch(() => settingsStore.currency, () => {
    exchangeRate.value = undefined;
    void fetchExchangeRate();
  });
  // A server or mode change replaces the network's provider at once, so the next wallet constructed
  // starts on the new servers; the active wallet moves there through selectElectrumProvider
  watch([() => settingsStore.electrumServer, () => settingsStore.electrumMode], () => {
    setDefaultElectrumServers();
    for (const network of appNetworks) void providerForSelectedServer(network);
  }, { deep: true });

  async function fetchTokenInfo(categoryId: string) {
    if (!tokenMetadataIndexer.value) throw new Error(t('store.errors.noTokenMetadataIndexer', { network: network.value }));
    const res = await cachedFetch(`${tokenMetadataIndexer.value}/tokens/${categoryId}/`);
    if (!res.ok) throw new Error(`Failed to fetch token info: ${res.status}`);
    // the helper logs why a reply was unusable, so the throw only has to say that it was
    const tokenMetadataIndexerResult = await parseIndexerResponse(res);
    if (!tokenMetadataIndexerResult) throw new Error(t('store.errors.bcmrIndexerValidationError'));
    return tokenMetadataIndexerResult;
  }

  // Fetch NFT metadata for a specific category and commitment, updating bcmrRegistries
  async function fetchNftMetadata(category: string, commitment: string) {
    const registries = await fetchNftMetadataFromIndexer(category, commitment, tokenMetadataIndexer.value, bcmrRegistries.value);
    bcmrRegistries.value = registries;
  }


  async function parseNftCommitment(categoryId: string, utxo: Utxo) {
    const metadata = bcmrRegistries.value?.[categoryId];
    return parseNftCommitmentUtil(utxo, metadata, wallet.value.provider, wallet.value.networkPrefix);
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
    return gatewayUrl(tokenIconUri, settingsStore.ipfsGateway);
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

  // Token coins are held back the same way BCH coins are. That takes the pool narrowing to reach
  // every spend path, the library's token methods included, and the shortfall explanation below to
  // say why a send that used to fit no longer does.
  // Keyed by outpoint, so a coin this wallet made but has not seen yet can be held back too. A
  // resolve reserves what it found in one go, since the refresh at the end costs an electrum call.
  async function reserveOutpoints(outpoints: Outpoint[], reason: ReservationReason) {
    for (const outpoint of outpoints) {
      storedReservations.value = saveReservedOutpoint(network.value, wallet.value.name, outpoint, reason);
    }
    // the fungible balances count what can be spent, and nothing else re-reads them on their own
    updateTokenList();
    await refreshMaxAmountToSend();
  }

  // Drops a reservation without spending; cancelling a pledge goes through spend.releaseReservedCoin
  async function dropReservation(outpoint: string) {
    const releasedToken = walletUtxos.value?.find(utxo => outpointOf(utxo) === outpoint)?.token;
    storedReservations.value = deleteReservedOutpoint(network.value, wallet.value.name, outpoint);
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

  // Spending goes through store.spend so a reserved coin never enters the library's coin selection:
  // every reserved outpoint, BCH and token coin alike, goes in excludeUtxoIds, which every library
  // spend and token operation takes out of the wallet's current coins, so no snapshot of them can
  // trail. One whose coin is gone is ignored there. No caller passes send options through here,
  // so nothing can name a reserved coin back in. A frozen address goes in excludeAddresses, which
  // also catches the coins it received after walletUtxos was last read.
  function spendExclusions() {
    return { excludeUtxoIds: Object.keys(reservedUtxos.value), excludeAddresses: frozenAddresses.value };
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

  // The same question of an address in either of its forms: a token-aware address is not the
  // string hasAddress knows, so it is compared through the locking bytecode both encode
  function ownsAddress(address: string) {
    const decoded = cashAddressToLockingBytecode(address);
    if (typeof decoded === 'string') return false;
    return ownsLockingBytecode(decoded.bytecode);
  }

  // The wallet's own addresses in both forms, for the outputs an identity operation keeps here:
  // the current receive address, never a frozen one
  function walletAddresses() {
    return { bch: currentDepositAddress.value, token: currentTokenDepositAddress.value };
  }

  // A spend's steps after its broadcast, which run again when a broadcast whose outcome was
  // unknown is broadcast again
  type AfterBroadcast = (txId: string) => void | Promise<void>;
  // What a spend holds back of its own outputs when its broadcast's outcome is unknown: the
  // transaction may have gone through, and a next spend must not take that output in the meantime
  type HoldBack = (txId: string) => Promise<void>;

  // A spend that falls short while UTXOs are held back may have fallen short for that reason, and
  // the library cannot say so: it counted only the pool it was handed. So the reason is said after
  // its message, on a shortfall and no other error: every wallet holding an identity has a
  // reservation, and the sentence on a rejected broadcast would point its holder at releasing
  // the authhead.
  async function spendExplained<T extends { txId?: string }>(
    makeTransaction: () => Promise<T>,
    afterBroadcast?: AfterBroadcast,
    holdBack?: HoldBack,
  ): Promise<T> {
    let response: T;
    try {
      response = await makeTransaction();
    } catch (error) {
      // a reservation outliving its coin holds nothing back, so it explains nothing
      if (reservedWalletUtxos.value?.length && error instanceof InsufficientFundsError) {
        throw new Error(`${error.message} ${t('store.errors.utxosHeldBack')}`, { cause: error });
      }
      // a coin the spend names, an identity UTXO say, that the wallet's coins no longer hold:
      // spent elsewhere since it was read, the current view not having caught up
      if (error instanceof UtxoNotAvailableError) {
        const message = error.reason === 'excluded' ? t('store.errors.tokenUtxoHeldBack') : t('store.errors.utxoNotAvailable');
        throw new Error(message, { cause: error });
      }
      if (holdBack && error instanceof BroadcastTimeoutError) await holdBack(error.txid);
      throw explainBroadcastError(error, afterBroadcast);
    }
    if (afterBroadcast && response.txId) await afterBroadcast(response.txId);
    return response;
  }

  // A rejected broadcast said in the user's terms, the node's own words kept as the cause. One
  // whose outcome is unknown offers to broadcast the same transaction again.
  function explainBroadcastError(error: unknown, afterBroadcast?: AfterBroadcast) {
    const errorKind = classifyBroadcastError(error);
    if (errorKind === 'other') return error;
    console.error(error);
    const message = broadcastErrorMessage(errorKind, false);
    if (error instanceof BroadcastTimeoutError) {
      const started = currentInitialization;
      return new ActionableError(message, {
        cause: error,
        action: {
          label: t('common.actions.broadcastAgain'),
          run: () => broadcastAgain(error.transaction, started, afterBroadcast),
        },
      });
    }
    return new Error(message, { cause: error });
  }

  // A broadcast whose outcome is unknown is settled by broadcasting the same transaction again:
  // the node takes it or answers that it already holds it, so it can never pay twice, where
  // sending again builds a new transaction from other coins. The steps after the broadcast run
  // then, so they are refused once another wallet is open.
  async function broadcastAgain(transaction: string, started: number, afterBroadcast?: AfterBroadcast) {
    if (walletSwitchedSince(started)) throw new Error(t('store.errors.broadcastAgainWalletSwitched'));
    const { txId } = await spendExplained(
      async () => ({ txId: await wallet.value.submitTransaction(hexToBin(transaction)) }),
      afterBroadcast,
    );
    Notify.create({ type: 'positive', message: t('store.notifications.broadcastAgainSent', { txId }) });
    await updateWalletUtxos();
    void updateWalletHistory();
  }

  // A spend that names one specific coin, an NFT transfer or burn, cannot fall back on another the
  // way an amount can, so a held back one is refused here rather than left to fail on the library's
  // terms. Frozen coins are spendable deliberately, but from utxo management rather than from here.
  function checkTokenUtxosSpendable(utxos: Utxo[]) {
    const held = utxos.find(utxo => outpointOf(utxo) in reservedUtxos.value);
    if (!held) return;
    // an identity's UTXO is released from the identities page, a frozen one from utxo management
    if (reservedUtxos.value[outpointOf(held)] === 'auth') {
      throw new Error(t('store.errors.identityUtxoHeldBack'));
    }
    throw new Error(t('store.errors.tokenUtxoHeldBack'));
  }

  // Spends one coin whole: a pool of only that coin, sent with sendMax, so no other coin joins
  // the transaction and no change returns. A reservation on the coin is dropped only once
  // broadcast, so a failure leaves the coin held rather than released into the next unrelated send.
  async function sendSingleCoin(utxo: Utxo, cashaddr: string) {
    const afterBroadcast = async () => {
      // The coin is gone, so refresh before dropping the reservation: otherwise the spendable
      // pool still holds it and the max-amount refresh asks the server about a spent outpoint
      await updateWalletUtxos();
      const outpoint = outpointOf(utxo);
      if (outpoint in reservedUtxos.value) await dropReservation(outpoint);
      else await refreshMaxAmountToSend();
    };
    const response = await wallet.value.sendMax(cashaddr, { utxoIds: [utxo] })
      .catch((error: unknown) => {
        throw explainBroadcastError(error, afterBroadcast);
      });
    await afterBroadcast();
    return response;
  }

  const spend = {
    // An NFT send names its coins in ensureUtxos: matched by commitment alone, a mutable NFT spent
    // elsewhere since it was shown would be minted anew off the category's minting NFT
    async send(requests: SendRequestType, ensureUtxos: Utxo[] = [], afterBroadcast?: AfterBroadcast, holdBack?: HoldBack) {
      return spendExplained(() => wallet.value.send(requests, { ...spendExclusions(), ensureUtxos }), afterBroadcast, holdBack);
    },
    async sendMax(cashaddr: string) {
      return spendExplained(() => wallet.value.sendMax(cashaddr, spendExclusions()));
    },
    // the library takes the first vout-0 BCH coin of the pool it is handed as the genesis input,
    // and that coin's txid becomes the category, so the picked coin goes at the front of the pool.
    // Naming the order takes a read of the wallet's coins, which no other spend needs.
    async tokenGenesis(
      genesisInput: Utxo,
      genesisRequest: TokenGenesisRequest,
      sendRequests?: SendRequestType | SendRequestType[]
    ) {
      const outpoint = outpointOf(genesisInput);
      const allUtxos = await wallet.value.getUtxos();
      const spendable = filterSpendableUtxos(allUtxos);
      const picked = spendable.find(utxo => outpointOf(utxo) === outpoint);
      // a coin spent elsewhere since it was picked would otherwise create a category nobody chose
      if (!picked || picked.vout !== 0 || picked.token) throw new Error(t('store.errors.genesisInputUnavailable'));
      const otherCoins = spendable.filter(utxo => outpointOf(utxo) !== outpoint);
      const pool = [picked, ...otherCoins];
      return spendExplained(() => wallet.value.tokenGenesis(genesisRequest, sendRequests, { ...spendExclusions(), utxoIds: pool }));
    },
    // tokenMint and tokenBurn locate their token input themselves, the minting NFT and the burned
    // coins included, and leave the excluded coins out of that too
    async tokenMint(mintRequests: TokenMintRequest | TokenMintRequest[]) {
      return spendExplained(() => wallet.value.tokenMint(mintRequests, spendExclusions()));
    },
    async tokenBurn(burnRequest: TokenBurnRequest, message?: string) {
      return spendExplained(() => wallet.value.tokenBurn(burnRequest, message, spendExclusions()));
    },
    async getMaxAmountToSend() {
      return wallet.value.getMaxAmountToSend(spendExclusions());
    },

    // The one path that spends past a reservation: every identity operation is this spend, the old
    // authhead in and the new one at output 0. The options are what a mint needs and no wider,
    // since a pool or an ensureUtxos passed here would undo that. An authhead the wallet no longer
    // holds, moved by an update made elsewhere, fails as not available.
    async spendAuthUtxo(
      authUtxo: Utxo,
      requests: SendRequestType,
      categoryUtxos: Utxo[] = [],
      options: { tokenOperation?: 'send' | 'mint' } = {},
    ) {
      const identitiesStore = useIdentitiesStore();
      // only the token coins the operation asked for, so a supply operation cannot sweep the
      // circulating balance into its own change; the other reservations stay excluded on top, a
      // held back coin among the ones asked for included
      const authOutpoint = outpointOf(authUtxo);
      const excludeUtxoIds = Object.keys(reservedUtxos.value).filter(outpoint => outpoint !== authOutpoint);
      // an identity coin on a frozen address is still spent here, its reservation being what holds
      // it, so that address leaves excludeAddresses and its other coins go in excludeUtxoIds,
      // read fresh so that one arrived since walletUtxos was read stays out too
      const excludeAddresses = frozenAddresses.value.filter(address => address !== authUtxo.address);
      if (excludeAddresses.length < frozenAddresses.value.length) {
        const allUtxos = await wallet.value.getUtxos();
        for (const utxo of allUtxos) {
          const outpoint = outpointOf(utxo);
          if (utxo.address !== authUtxo.address || outpoint === authOutpoint) continue;
          if (!excludeUtxoIds.includes(outpoint)) excludeUtxoIds.push(outpoint);
        }
      }
      // The authhead has moved to output 0 of this transaction. When that is ours, it is held back
      // now, before the wallet's own view or Chaingraph has seen the transaction: the first request
      // says where it went, which no utxo snapshot can yet. A transfer's output 0 is not ours. A
      // broadcast whose outcome is unknown holds it back too, as it may have gone through.
      const holdBackNewAuthhead = async (txId: string) => {
        const first = Array.isArray(requests) ? requests[0] : requests;
        const newAuthhead = `${txId}:0`;
        if (first && 'cashaddr' in first && ownsAddress(first.cashaddr) && !storedReservations.value[newAuthhead]) {
          await reserveOutpoints([newAuthhead], 'auth');
        }
      };
      const afterBroadcast = async (txId: string) => {
        await holdBackNewAuthhead(txId);
        await updateWalletUtxos();
        await identitiesStore.refreshIdentities();
      };
      return spendExplained(() => wallet.value.send(requests, {
        ...options,
        tokenUtxoIds: [authUtxo, ...categoryUtxos],
        excludeUtxoIds,
        excludeAddresses,
        ensureUtxos: [authUtxo],
      }), afterBroadcast, holdBackNewAuthhead);
    },

    // Cancelling a pledge is this coin sent back to the wallet's own deposit address, which
    // makes the signed pledge the campaign holds unusable
    async releaseReservedCoin(utxo: Utxo) {
      return sendSingleCoin(utxo, currentDepositAddress.value);
    },

    // The user spending one chosen coin whole, frozen or not. A pledged coin is refused: the
    // campaign holds a signed pledge against it, so cancelling the pledge is its only release.
    // An 'auth' reserved coin passes deliberately, transferring an identity is this same spend.
    async sendUtxo(utxo: Utxo, cashaddr: string) {
      if (reservedUtxos.value[outpointOf(utxo)] === 'pledge') {
        throw new Error(t('store.errors.cannotSendPledgedUtxo'));
      }
      // a coin on a frozen address is released by unfreezing the address, not by sending it
      if (reservedUtxos.value[outpointOf(utxo)] === 'address') {
        throw new Error(t('store.errors.tokenUtxoHeldBack'));
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
    ownsAddress,
    ownsLockingBytecode,
    walletAddresses,
    balance, // everything held, including reserved coins
    spendableBalance, // balance minus reservedBalance
    reservedBalance,
    maxAmountToSend,
    walletUtxos,
    spendableUtxos,
    reservedUtxos, // stored reservations plus the coins on frozen addresses
    storedReservations,
    filterSpendableUtxos,
    spendExclusions,
    reservedWalletUtxos,
    reserveOutpoints,
    currentInitializationToken,
    walletSwitchedSince,
    broadcastAgain,
    dropReservation,
    utxoLabels,
    setUtxoLabel,
    spend, // the only route to the wallet's spending methods
    tokenList,
    allTokenList,
    filteredTokenList,
    walletHistory,
    isHistoryPartial,
    walletTxids,
    txNotes,
    dappActivity,
    dappActivityByTxid,
    unseenDappActivityCount,
    setTxNote,
    recordDappActivity,
    clearActiveDappActivity,
    markDappActivitySeen,
    addressMarks,
    addressLabels,
    currentAddressIndex,
    currentDepositAddress,
    currentTokenDepositAddress,
    markAddressUsed,
    unmarkAddressUsed,
    frozenAddresses,
    frozenLockingBytecodes,
    freezeAddress,
    unfreezeAddress,
    setAddressLabel,
    walletInitFailed,
    pendingTokenSearch,
    pendingHistorySearch,
    dappConnectionStoresInitDone,
    latestGithubRelease,
    network,
    explorerUrl,
    chaingraph,
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
    selectElectrumProvider,
    electrumServerInUse,
    validateElectrumServer,
    initializeWallet,
    resetWalletState,
    updateWalletUtxos,
    updateWalletHistory,
    changeNetwork,
    switchWallet,
    refreshAvailableWallets,
    deleteWallet,
    removeChipnetCopy,
    removingChipnetCopy,
    addWalletNetwork,
    fetchTokenInfo,
    fetchNftMetadata,
    parseNftCommitment,
    checkTokenUtxosSpendable,
    fetchTokenMetadata,
    fetchCauldronPricesForTokens,
    fetchWalletCauldronPools,
    fetchWalletBadgerLocks,
    fetchWalletAnnouncedAssets,
    loadAllHistory,
    ensureFullHistory,
    loadingFullHistory,
    indexedTransactions,
    toggleFavorite,
    toggleHidden,
    tokenIconUrl,
    loadExistingWallet
  }
})
