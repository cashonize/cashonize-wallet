import {
  Wallet,
  HDWallet,
  TestNetWallet,
  TestNetHDWallet,
  Config,
  getAddrsByXpubKey,
  getNetworkProvider,
  getXPubKey,
  namedWalletExists,
  saveNamedWallet,
  networkConfig,
  type ElectrumNetworkProvider,
} from "@cashonize/bch-wallet-lib"
import { deriveSeedFromBip39Mnemonic } from "@bitauth/libauth"
import { Notify } from "quasar"
import { useStore } from 'src/stores/store'
import { useSettingsStore } from 'src/stores/settingsStore'
import { getAllWalletsWithNetworkInfo } from 'src/utils/wallet/dbUtils'
import { isQuotaExceededError } from 'src/utils/errorHandling'
import { isValidBip39Mnemonic, normalizeSeedPhrase } from 'src/utils/utils'
import { appNetworks, libraryNetwork, walletDbName, type AppNetwork } from 'src/utils/wallet/networks'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export type DerivationPathType = "standard" | "bitcoindotcom" | "slp";

// BIP44 derivation paths for BCH wallets
// - parent: used by the library's Config when generating new wallets via Wallet.named()
// - full: used in explicit walletId strings for saveNamedWallet() imports
export const DERIVATION_PATHS = {
  // BCH coin type, used by the large majority of BCH wallets
  standard: {
    parent: "m/44'/145'/0'",
    full: "m/44'/145'/0'/0/0",
  },
  // BTC coin type, used by the Bitcoin.com wallet and read.cash
  bitcoindotcom: {
    parent: "m/44'/0'/0'",
    full: "m/44'/0'/0'/0/0",
  },
  // SLP coin type, used by Zapit and older SLP wallets
  slp: {
    parent: "m/44'/245'/0'",
    full: "m/44'/245'/0'/0/0",
  },
} as const;

// Order determines the order paths are reported in after a scan
const SCANNED_PATH_TYPES: DerivationPathType[] = ["standard", "bitcoindotcom", "slp"];

export interface DerivationPathScanResult {
  usedPaths: DerivationPathType[];
  multipleAddressesUsed: boolean;
}

// BIP44 address discovery stops after this many consecutive unused addresses
export const GAP_LIMIT = 20;
// Address history queries are pipelined over the same electrum connection in batches
const SCAN_BATCH_SIZE = 10;

// Whether any of the addresses has history, asked in order and in batches, so that a batch with
// activity ends the scan
export async function anyAddressHasActivity(provider: ElectrumNetworkProvider, addresses: string[]): Promise<boolean> {
  for (let i = 0; i < addresses.length; i += SCAN_BATCH_SIZE) {
    const batch = addresses.slice(i, i + SCAN_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (address) => {
      const history = await provider.getHistory(address);
      return history.length > 0;
    }));
    if (batchResults.includes(true)) return true;
  }
  return false;
}

/**
 * Scans which supported derivation path a seed phrase has on-chain activity on,
 * by checking the transaction history of the first address of each path.
 * BIP44 wallets fill addresses starting at index 0, so a used wallet is expected
 * to have history on its first address. Paths with activity are then scanned up
 * to the standard gap limit on both the receive and change chains: activity
 * beyond the first receive address means the seed phrase was used as an HD
 * wallet, so a single address import would miss funds.
 * The addresses are derived from each path's xpub and their history asked of the
 * network's provider directly: a wallet built per address would subscribe to it.
 */
export async function scanDerivationPaths(seedPhrase: string, network: AppNetwork = 'mainnet'): Promise<DerivationPathScanResult> {
  const seed = deriveSeedFromBip39Mnemonic(normalizeSeedPhrase(seedPhrase));
  // the global provider a wallet of the network is constructed on, made from the selected server
  const provider = getNetworkProvider(libraryNetwork(network));
  // the receive and change chains are unhardened, so the parent's xpub derives every address
  const keyVersion = networkConfig(libraryNetwork(network)).keyVersion;
  const xpubOf = (pathType: DerivationPathType) => getXPubKey(seed, DERIVATION_PATHS[pathType].parent, keyVersion);

  // Receive and change chains are interleaved by index so the addresses most
  // likely to be used are checked first, letting the scan end early on the
  // first batch with activity
  async function laterAddressesHaveActivity(xpub: string): Promise<boolean> {
    const receiveAddresses = getAddrsByXpubKey(xpub, "0/1", GAP_LIMIT);
    const changeAddresses = getAddrsByXpubKey(xpub, "1/0", GAP_LIMIT);
    const addresses = receiveAddresses.flatMap((receiveAddress, index) => [receiveAddress, changeAddresses[index]!]);
    return anyAddressHasActivity(provider, addresses);
  }

  const xpubs = SCANNED_PATH_TYPES.map(xpubOf);
  const pathHasActivity = await Promise.all(
    xpubs.map((xpub) => anyAddressHasActivity(provider, getAddrsByXpubKey(xpub, "0/0", 1)))
  );
  const usedPaths = SCANNED_PATH_TYPES.filter((_pathType, index) => pathHasActivity[index]);

  let multipleAddressesUsed = false;
  for (const usedPath of usedPaths) {
    const xpub = xpubs[SCANNED_PATH_TYPES.indexOf(usedPath)]!;
    if (await laterAddressesHaveActivity(xpub)) {
      multipleAddressesUsed = true;
      break;
    }
  }

  return { usedPaths, multipleAddressesUsed };
}

export interface CreateWalletResult {
  success: true;
  walletName: string;
}

export interface WalletError {
  success: false;
  message: string;
  isUserError: boolean; // true = grey notification, false = red notification
}

export type WalletOperationResult = CreateWalletResult | WalletError;

function makeError(message: string, isUserError: boolean): WalletError {
  return { success: false, message, isUserError };
}

// Invisible/zero-width chars that could be used for spoofing
const INVALID_NAME_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/;
const MAX_WALLET_NAME_LENGTH = 50;

export function validateWalletName(name: string): WalletError | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return makeError(t('walletUtils.errors.enterWalletName'), true);
  }
  if (trimmed.length > MAX_WALLET_NAME_LENGTH) {
    return makeError(t('walletUtils.errors.walletNameTooLong', { max: MAX_WALLET_NAME_LENGTH }), true);
  }
  if (INVALID_NAME_CHARS.test(trimmed)) {
    return makeError(t('walletUtils.errors.walletNameInvalidChars'), true);
  }
  return null;
}

// A name belongs to one wallet across all networks: wallet type, backup status and the other
// settings are keyed by the name alone
export async function walletNameTaken(name: string): Promise<boolean> {
  for (const network of appNetworks) {
    if (await namedWalletExists(name, walletDbName(network))) return true;
  }
  return false;
}

// Suggest a name for the user's next wallet, continuing the "wallet <number>" convention, or for a
// development wallet "test wallet", then "test wallet 2" and so on. Counts past the highest number
// in use instead of filling gaps, so a deleted wallet's name (and any leftover localStorage data
// keyed on it) is never reused. Names are unique across networks, so every wallet's name counts.
export async function suggestNextWalletName(network: AppNetwork = 'mainnet'): Promise<string> {
  const existingWallets = await getAllWalletsWithNetworkInfo();
  if (network !== 'mainnet') {
    let highestTestNumber = 0;
    for (const walletInfo of existingWallets) {
      if (walletInfo.name === 'test wallet') highestTestNumber = Math.max(highestTestNumber, 1);
      const match = walletInfo.name.match(/^test wallet (\d+)$/);
      if (match) highestTestNumber = Math.max(highestTestNumber, Number(match[1]));
    }
    if (!highestTestNumber) return 'test wallet';
    return `test wallet ${highestTestNumber + 1}`;
  }
  let highestNumber = 0;
  for (const walletInfo of existingWallets) {
    const match = walletInfo.name.match(/^wallet (\d+)$/);
    if (match) highestNumber = Math.max(highestNumber, Number(match[1]));
  }
  // No numbered names yet (e.g. only "mywallet"): number by the mainnet wallets, so the
  // second wallet is suggested as "wallet 2"
  const mainnetWalletCount = existingWallets.filter(walletInfo => walletInfo.hasMainnet).length;
  const nextNumber = highestNumber ? highestNumber + 1 : mainnetWalletCount + 1;
  return `wallet ${nextNumber}`;
}

/**
 * Creates a new wallet with the given name, on the given network only.
 */
export async function createNewWallet(name: string, network: AppNetwork = 'mainnet'): Promise<WalletOperationResult> {
  const validationError = validateWalletName(name);
  if (validationError) return validationError;
  const trimmedName = name.trim();

  try {
    if (await walletNameTaken(trimmedName)) {
      return makeError(t('walletUtils.errors.walletAlreadyExists', { name: trimmedName }), true);
    }

    const store = useStore();
    const settingsStore = useSettingsStore();

    // the library's default is the BCH standard path too; set here so a new wallet's path never
    // depends on the library's default
    Config.DefaultParentDerivationPath = DERIVATION_PATHS.standard.parent;
    // .named() deliberately creates the new wallet here (non-existence checked above),
    // elsewhere wallets should be loaded through store.loadExistingWallet
    const WalletClass = network === 'mainnet' ? Wallet : TestNetWallet;
    const newWallet = await WalletClass.named(trimmedName);

    // Update store state
    store.activeWalletName = trimmedName;
    localStorage.setItem('activeWalletName', trimmedName);
    localStorage.setItem('network', network);
    // Clear previous wallet's state and dapp sessions before setting the new wallet (mirrors switchWallet)
    await store.resetWalletState();
    await store.setWallet(newWallet);

    // Refresh available wallets list
    await store.refreshAvailableWallets();

    // A new wallet can take the name of a deleted one, and everything per wallet is keyed by
    // name, so drop what the old one left before recording anything of this one's
    settingsStore.clearWalletSettings(trimmedName);
    // Fire-and-forget: don't wait on full wallet initialization
    void store.initializeWallet();

    // Store wallet creation date
    settingsStore.setWalletCreatedAt(trimmedName);

    return { success: true, walletName: trimmedName };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return makeError(t('walletUtils.errors.storageFull'), false);
    }
    return makeError(t('walletUtils.errors.failedToCreateWallet'), false);
  }
}

export interface ImportWalletParams {
  name: string;
  seedPhrase: string;
  seedPhraseValid: boolean;
  derivationPath: DerivationPathType;
  network?: AppNetwork;
}

/**
 * Imports a wallet from a seed phrase, on the given network only.
 */
export async function importWallet(params: ImportWalletParams): Promise<WalletOperationResult> {
  const { seedPhrase, seedPhraseValid, derivationPath, network = 'mainnet' } = params;
  const normalizedSeedPhrase = normalizeSeedPhrase(seedPhrase);

  const validationError = validateWalletName(params.name);
  if (validationError) return validationError;
  const trimmedName = params.name.trim();

  if (!normalizedSeedPhrase) {
    return makeError(t('walletUtils.errors.enterSeedPhrase'), true);
  }

  if (!seedPhraseValid) {
    return makeError(t('walletUtils.errors.fixInvalidWords'), true);
  }

  if (!isValidBip39Mnemonic(normalizedSeedPhrase)) {
    return makeError(t('walletUtils.errors.invalidSeedPhrase'), true);
  }

  try {
    if (await walletNameTaken(trimmedName)) {
      return makeError(t('walletUtils.errors.walletAlreadyExists', { name: trimmedName }), true);
    }

    const store = useStore();
    const settingsStore = useSettingsStore();

    const fullDerivationPath = DERIVATION_PATHS[derivationPath].full;

    // stored without constructing it, then loaded by name below
    const walletId = `seed:${libraryNetwork(network)}:${normalizedSeedPhrase}:${fullDerivationPath}`;
    await saveNamedWallet(trimmedName, walletId, walletDbName(network));

    const WalletClass = network === 'mainnet' ? Wallet : TestNetWallet;
    const importedWallet = await WalletClass.named(trimmedName);

    // Update store state
    store.activeWalletName = trimmedName;
    localStorage.setItem('activeWalletName', trimmedName);
    localStorage.setItem('network', network);
    // Clear previous wallet's state and dapp sessions before setting the new wallet (mirrors switchWallet)
    await store.resetWalletState();
    await store.setWallet(importedWallet);

    // Refresh available wallets list
    await store.refreshAvailableWallets();

    settingsStore.clearWalletSettings(trimmedName);
    // Fire-and-forget: don't wait on full wallet initialization
    void store.initializeWallet();

    // Mark as 'imported' - user already demonstrated having the seed phrase
    settingsStore.setBackupStatus(trimmedName, 'imported');

    // Store wallet creation date (import date)
    settingsStore.setWalletCreatedAt(trimmedName);

    return { success: true, walletName: trimmedName };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return makeError(t('walletUtils.errors.storageFull'), false);
    }
    return makeError(t('walletUtils.errors.invalidSeedPhrase'), false);
  }
}

/**
 * Creates a new HD wallet with the given name, on the given network only.
 * HD wallets support multiple addresses (BIP44) with automatic address discovery.
 */
export async function createNewHDWallet(name: string, network: AppNetwork = 'mainnet'): Promise<WalletOperationResult> {
  const validationError = validateWalletName(name);
  if (validationError) return validationError;
  const trimmedName = name.trim();

  try {
    if (await walletNameTaken(trimmedName)) {
      return makeError(t('walletUtils.errors.walletAlreadyExists', { name: trimmedName }), true);
    }

    const store = useStore();
    const settingsStore = useSettingsStore();

    Config.DefaultParentDerivationPath = DERIVATION_PATHS.standard.parent;
    // .named() deliberately creates the new wallet here (non-existence checked above),
    // elsewhere wallets should be loaded through store.loadExistingWallet
    const WalletClass = network === 'mainnet' ? HDWallet : TestNetHDWallet;
    const newWallet = await WalletClass.named(trimmedName);

    store.activeWalletName = trimmedName;
    localStorage.setItem('activeWalletName', trimmedName);
    localStorage.setItem('network', network);
    // Clear previous wallet's state and dapp sessions before setting the new wallet (mirrors switchWallet)
    await store.resetWalletState();
    await store.setWallet(newWallet);

    settingsStore.clearWalletSettings(trimmedName);
    // Set wallet type BEFORE initializeWallet (which validates type matches)
    settingsStore.setWalletType(trimmedName, 'hd');
    settingsStore.setWalletCreatedAt(trimmedName);

    await store.refreshAvailableWallets();
    void store.initializeWallet();

    return { success: true, walletName: trimmedName };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return makeError(t('walletUtils.errors.storageFull'), false);
    }
    return makeError(t('walletUtils.errors.failedToCreateWallet'), false);
  }
}

/**
 * Imports an HD wallet from a seed phrase, on the given network only.
 * HD wallets support multiple addresses (BIP44) with automatic address discovery.
 */
export async function importHDWallet(params: ImportWalletParams): Promise<WalletOperationResult> {
  const { seedPhrase, seedPhraseValid, derivationPath, network = 'mainnet' } = params;
  const normalizedSeedPhrase = normalizeSeedPhrase(seedPhrase);

  const validationError = validateWalletName(params.name);
  if (validationError) return validationError;
  const trimmedName = params.name.trim();

  if (!normalizedSeedPhrase) {
    return makeError(t('walletUtils.errors.enterSeedPhrase'), true);
  }

  if (!seedPhraseValid) {
    return makeError(t('walletUtils.errors.fixInvalidWords'), true);
  }

  if (!isValidBip39Mnemonic(normalizedSeedPhrase)) {
    return makeError(t('walletUtils.errors.invalidSeedPhrase'), true);
  }

  try {
    if (await walletNameTaken(trimmedName)) {
      return makeError(t('walletUtils.errors.walletAlreadyExists', { name: trimmedName }), true);
    }

    const store = useStore();
    const settingsStore = useSettingsStore();

    const parentDerivationPath = DERIVATION_PATHS[derivationPath].parent;

    // stored without constructing it, then loaded by name below
    const walletId = `hd:${libraryNetwork(network)}:${normalizedSeedPhrase}:${parentDerivationPath}:0:0`;
    await saveNamedWallet(trimmedName, walletId, walletDbName(network));

    const WalletClass = network === 'mainnet' ? HDWallet : TestNetHDWallet;
    const importedWallet = await WalletClass.named(trimmedName);

    store.activeWalletName = trimmedName;
    localStorage.setItem('activeWalletName', trimmedName);
    localStorage.setItem('network', network);
    // Clear previous wallet's state and dapp sessions before setting the new wallet (mirrors switchWallet)
    await store.resetWalletState();
    await store.setWallet(importedWallet);

    settingsStore.clearWalletSettings(trimmedName);
    // Set wallet type BEFORE initializeWallet (which validates type matches)
    settingsStore.setWalletType(trimmedName, 'hd');
    settingsStore.setBackupStatus(trimmedName, 'imported');
    settingsStore.setWalletCreatedAt(trimmedName);

    await store.refreshAvailableWallets();
    void store.initializeWallet();

    return { success: true, walletName: trimmedName };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return makeError(t('walletUtils.errors.storageFull'), false);
    }
    return makeError(t('walletUtils.errors.invalidSeedPhrase'), false);
  }
}

// The most named wallets the UI lets you add
export const maxWallets = 20;

// Switch to another named wallet from the UI, saying so when its network differs from the current one
export async function switchWalletWithNotice(walletName: string) {
  const store = useStore();
  if (walletName === store.activeWalletName) return;
  try {
    const result = await store.switchWallet(walletName);
    if (result.networkChanged) {
      useSettingsStore().hasPlayedAnimation = false;
      Notify.create({
        message: t('walletsOverview.switchedNetwork', { network: result.networkChanged, name: walletName }),
        icon: 'info',
        color: "grey-6"
      });
    }
  } catch (error) {
    Notify.create({
      message: t('walletsOverview.switchFailed', { error: error instanceof Error ? error.message : 'Unknown error' }),
      icon: 'warning',
      color: "red"
    });
  }
}
