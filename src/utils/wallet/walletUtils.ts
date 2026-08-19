import { Wallet, TestNetWallet, HDWallet, TestNetHDWallet, Config } from "mainnet-js"
import { useStore } from 'src/stores/store'
import { useSettingsStore } from 'src/stores/settingsStore'
import { namedWalletExistsInDb, getAllWalletsWithNetworkInfo } from 'src/utils/wallet/dbUtils'
import { isQuotaExceededError } from 'src/utils/errorHandling'
import { isValidBip39Mnemonic, normalizeSeedPhrase } from 'src/utils/utils'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export type DerivationPathType = "standard" | "bitcoindotcom" | "slp";

// BIP44 derivation paths for BCH wallets
// - parent: used by mainnet-js Config when generating new wallets via Wallet.named()
// - full: used in explicit walletId strings for Wallet.replaceNamed() imports
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
const GAP_LIMIT = 20;
// Address history queries are pipelined over the same electrum connection in batches
const SCAN_BATCH_SIZE = 10;

/**
 * Scans which supported derivation path a seed phrase has on-chain activity on,
 * by checking the transaction history of the first address of each path.
 * BIP44 wallets fill addresses starting at index 0, so a used wallet is expected
 * to have history on its first address. Paths with activity are then scanned up
 * to the standard gap limit on both the receive and change chains: activity
 * beyond the first receive address means the seed phrase was used as an HD
 * wallet, so a single address import would miss funds.
 */
export async function scanDerivationPaths(seedPhrase: string): Promise<DerivationPathScanResult> {
  const normalizedSeedPhrase = normalizeSeedPhrase(seedPhrase);

  async function addressHasActivity(fullDerivationPath: string): Promise<boolean> {
    const addressWallet = await Wallet.fromSeed(normalizedSeedPhrase, fullDerivationPath);
    const history = await addressWallet.getRawHistory();
    return history.length > 0;
  }

  // Receive and change chains are interleaved by index so the addresses most
  // likely to be used are checked first, letting the scan end early on the
  // first batch with activity
  async function laterAddressesHaveActivity(parentDerivationPath: string): Promise<boolean> {
    const addressPaths: string[] = [];
    for (let addressIndex = 0; addressIndex < GAP_LIMIT; addressIndex++) {
      addressPaths.push(`${parentDerivationPath}/0/${addressIndex + 1}`);
      addressPaths.push(`${parentDerivationPath}/1/${addressIndex}`);
    }
    for (let i = 0; i < addressPaths.length; i += SCAN_BATCH_SIZE) {
      const batch = addressPaths.slice(i, i + SCAN_BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(addressHasActivity));
      if (batchResults.includes(true)) return true;
    }
    return false;
  }

  const pathHasActivity = await Promise.all(
    SCANNED_PATH_TYPES.map((pathType) => addressHasActivity(DERIVATION_PATHS[pathType].full))
  );
  const usedPaths = SCANNED_PATH_TYPES.filter((_pathType, index) => pathHasActivity[index]);

  let multipleAddressesUsed = false;
  for (const usedPath of usedPaths) {
    if (await laterAddressesHaveActivity(DERIVATION_PATHS[usedPath].parent)) {
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

// Suggest a name for the user's next wallet, continuing the "wallet <number>" convention.
// Counts past the highest number in use instead of filling gaps, so a deleted wallet's
// name (and any leftover localStorage data keyed on it) is never reused.
export async function suggestNextWalletName(): Promise<string> {
  const existingWallets = await getAllWalletsWithNetworkInfo();
  let highestNumber = 0;
  for (const walletInfo of existingWallets) {
    const match = walletInfo.name.match(/^wallet (\d+)$/);
    if (match) highestNumber = Math.max(highestNumber, Number(match[1]));
  }
  // No numbered names yet (e.g. only "mywallet"): number by wallet count, so the
  // second wallet is suggested as "wallet 2"
  const nextNumber = highestNumber ? highestNumber + 1 : existingWallets.length + 1;
  return `wallet ${nextNumber}`;
}

/**
 * Creates a new wallet with the given name.
 * Handles mainnet and testnet wallet creation, store updates, and metadata.
 */
export async function createNewWallet(name: string): Promise<WalletOperationResult> {
  const validationError = validateWalletName(name);
  if (validationError) return validationError;
  const trimmedName = name.trim();

  try {
    // Check if wallet already exists in either network DB
    const existsMainnet = await namedWalletExistsInDb(trimmedName, "bitcoincash");
    const existsChipnet = await namedWalletExistsInDb(trimmedName, "bchtest");
    if (existsMainnet || existsChipnet) {
      return makeError(t('walletUtils.errors.walletAlreadyExists', { name: trimmedName }), true);
    }

    const store = useStore();
    const settingsStore = useSettingsStore();

    // mainnet-js defaults to m/44'/0'/0' (bitcoindotcom), override to use BCH standard
    Config.DefaultParentDerivationPath = DERIVATION_PATHS.standard.parent;
    // .named() deliberately creates the new wallet here (non-existence checked above),
    // elsewhere wallets should be loaded through store.loadExistingWallet
    const mainnetWallet = await Wallet.named(trimmedName);
    const walletId = mainnetWallet.toDbString().replace("mainnet", "testnet");
    await TestNetWallet.replaceNamed(trimmedName, walletId);

    // Update store state
    store.activeWalletName = trimmedName;
    localStorage.setItem('activeWalletName', trimmedName);
    // Clear previous wallet's state and dapp sessions before setting the new wallet (mirrors switchWallet)
    await store.resetWalletState();
    store.setWallet(mainnetWallet);

    // Refresh available wallets list
    await store.refreshAvailableWallets();

    // Fire-and-forget: don't wait on full wallet initialization
    void store.initializeWallet();

    // Store wallet creation date
    settingsStore.setWalletCreatedAt(trimmedName);
    // Backup status is keyed by wallet name, so clear whatever a previous wallet of this name
    // left behind. Nothing else on this path writes it, and a stale 'verified' would tell the
    // user a seed they have never seen is already backed up.
    settingsStore.setBackupStatus(trimmedName, 'none');
    settingsStore.setWalletType(trimmedName, 'single');

    return { success: true, walletName: trimmedName };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return makeError(t('walletUtils.errors.storageFull'), false);
    }
    if (typeof error === 'string') {
      return makeError(error, true);
    }
    return makeError(t('walletUtils.errors.failedToCreateWallet'), false);
  }
}

export interface ImportWalletParams {
  name: string;
  seedPhrase: string;
  seedPhraseValid: boolean;
  derivationPath: DerivationPathType;
}

/**
 * Imports a wallet from a seed phrase.
 * Handles mainnet and testnet wallet creation, store updates, and metadata.
 */
export async function importWallet(params: ImportWalletParams): Promise<WalletOperationResult> {
  const { seedPhrase, seedPhraseValid, derivationPath } = params;
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
    // Check if wallet already exists in either network DB
    const existsMainnet = await namedWalletExistsInDb(trimmedName, "bitcoincash");
    const existsChipnet = await namedWalletExistsInDb(trimmedName, "bchtest");
    if (existsMainnet || existsChipnet) {
      return makeError(t('walletUtils.errors.walletAlreadyExists', { name: trimmedName }), true);
    }

    const store = useStore();
    const settingsStore = useSettingsStore();

    const fullDerivationPath = DERIVATION_PATHS[derivationPath].full;

    const walletId = `seed:mainnet:${normalizedSeedPhrase}:${fullDerivationPath}`;
    await Wallet.replaceNamed(trimmedName, walletId);

    const walletIdTestnet = `seed:testnet:${normalizedSeedPhrase}:${fullDerivationPath}`;
    await TestNetWallet.replaceNamed(trimmedName, walletIdTestnet);

    const mainnetWallet = await Wallet.named(trimmedName);

    // Update store state
    store.activeWalletName = trimmedName;
    localStorage.setItem('activeWalletName', trimmedName);
    // Clear previous wallet's state and dapp sessions before setting the new wallet (mirrors switchWallet)
    await store.resetWalletState();
    store.setWallet(mainnetWallet);

    // Refresh available wallets list
    await store.refreshAvailableWallets();

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
    if (typeof error === 'string') {
      return makeError(error, true);
    }
    return makeError(t('walletUtils.errors.invalidSeedPhrase'), false);
  }
}

/**
 * Creates a new HD wallet with the given name.
 * HD wallets support multiple addresses (BIP44) with automatic address discovery.
 */
export async function createNewHDWallet(name: string): Promise<WalletOperationResult> {
  const validationError = validateWalletName(name);
  if (validationError) return validationError;
  const trimmedName = name.trim();

  try {
    const existsMainnet = await namedWalletExistsInDb(trimmedName, "bitcoincash");
    const existsChipnet = await namedWalletExistsInDb(trimmedName, "bchtest");
    if (existsMainnet || existsChipnet) {
      return makeError(t('walletUtils.errors.walletAlreadyExists', { name: trimmedName }), true);
    }

    const store = useStore();
    const settingsStore = useSettingsStore();

    Config.DefaultParentDerivationPath = DERIVATION_PATHS.standard.parent;
    // .named() deliberately creates the new wallet here (non-existence checked above),
    // elsewhere wallets should be loaded through store.loadExistingWallet
    const mainnetWallet = await HDWallet.named(trimmedName);
    const walletId = mainnetWallet.toDbString().replace("mainnet", "testnet");
    await TestNetHDWallet.replaceNamed(trimmedName, walletId);

    store.activeWalletName = trimmedName;
    localStorage.setItem('activeWalletName', trimmedName);
    // Clear previous wallet's state and dapp sessions before setting the new wallet (mirrors switchWallet)
    await store.resetWalletState();
    store.setWallet(mainnetWallet);

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
    if (typeof error === 'string') {
      return makeError(error, true);
    }
    return makeError(t('walletUtils.errors.failedToCreateWallet'), false);
  }
}

/**
 * Imports an HD wallet from a seed phrase.
 * HD wallets support multiple addresses (BIP44) with automatic address discovery.
 */
export async function importHDWallet(params: ImportWalletParams): Promise<WalletOperationResult> {
  const { seedPhrase, seedPhraseValid, derivationPath } = params;
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
    const existsMainnet = await namedWalletExistsInDb(trimmedName, "bitcoincash");
    const existsChipnet = await namedWalletExistsInDb(trimmedName, "bchtest");
    if (existsMainnet || existsChipnet) {
      return makeError(t('walletUtils.errors.walletAlreadyExists', { name: trimmedName }), true);
    }

    const store = useStore();
    const settingsStore = useSettingsStore();

    const parentDerivationPath = DERIVATION_PATHS[derivationPath].parent;

    const walletId = `hd:mainnet:${normalizedSeedPhrase}:${parentDerivationPath}:0:0`;
    await HDWallet.replaceNamed(trimmedName, walletId);

    const walletIdTestnet = `hd:testnet:${normalizedSeedPhrase}:${parentDerivationPath}:0:0`;
    await TestNetHDWallet.replaceNamed(trimmedName, walletIdTestnet);

    const mainnetWallet = await HDWallet.named(trimmedName);

    store.activeWalletName = trimmedName;
    localStorage.setItem('activeWalletName', trimmedName);
    // Clear previous wallet's state and dapp sessions before setting the new wallet (mirrors switchWallet)
    await store.resetWalletState();
    store.setWallet(mainnetWallet);

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
    if (typeof error === 'string') {
      return makeError(error, true);
    }
    return makeError(t('walletUtils.errors.invalidSeedPhrase'), false);
  }
}
