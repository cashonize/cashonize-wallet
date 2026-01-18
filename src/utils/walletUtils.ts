import { Wallet, TestNetWallet, Config } from "mainnet-js"
import { useStore } from 'src/stores/store'
import { useSettingsStore } from 'src/stores/settingsStore'
import { namedWalletExistsInDb } from 'src/utils/dbUtils'
import { isQuotaExceededError } from 'src/utils/errorHandling'

export type DerivationPathType = "standard" | "bitcoindotcom";

// BIP44 derivation paths for BCH wallets
// - parent: used by mainnet-js Config when generating new wallets via Wallet.named()
// - full: used in explicit walletId strings for Wallet.replaceNamed() imports
export const DERIVATION_PATHS = {
  standard: {
    parent: "m/44'/145'/0'",
    full: "m/44'/145'/0'/0/0",
  },
  bitcoindotcom: {
    parent: "m/44'/0'/0'",
    full: "m/44'/0'/0'/0/0",
  },
} as const;

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
    return makeError("Please enter a wallet name", true);
  }
  if (trimmed.length > MAX_WALLET_NAME_LENGTH) {
    return makeError(`Wallet name too long (max ${MAX_WALLET_NAME_LENGTH} characters)`, true);
  }
  if (INVALID_NAME_CHARS.test(trimmed)) {
    return makeError("Wallet name contains invalid characters", true);
  }
  return null;
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
      return makeError(`Wallet "${trimmedName}" already exists`, true);
    }

    const store = useStore();
    const settingsStore = useSettingsStore();

    // mainnet-js defaults to m/44'/0'/0' (bitcoindotcom), override to use BCH standard
    Config.DefaultParentDerivationPath = DERIVATION_PATHS.standard.parent;
    const mainnetWallet = await Wallet.named(trimmedName);
    const walletId = mainnetWallet.toDbString().replace("mainnet", "testnet");
    await TestNetWallet.replaceNamed(trimmedName, walletId);

    // Update store state
    store.activeWalletName = trimmedName;
    localStorage.setItem('activeWalletName', trimmedName);
    store.setWallet(mainnetWallet);

    // Refresh available wallets list
    await store.refreshAvailableWallets();

    // Fire-and-forget: don't wait on full wallet initialization
    void store.initializeWallet();

    // Store wallet creation date
    settingsStore.setWalletCreatedAt(trimmedName);

    return { success: true, walletName: trimmedName };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return makeError("Storage full - unable to save wallet. Check browser storage settings.", false);
    }
    if (typeof error === 'string') {
      return makeError(error, true);
    }
    return makeError("Failed to create wallet", false);
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

  const validationError = validateWalletName(params.name);
  if (validationError) return validationError;
  const trimmedName = params.name.trim();

  if (!seedPhrase) {
    return makeError("Enter a seed phrase to import wallet", true);
  }

  if (!seedPhraseValid) {
    return makeError("Please fix invalid words in your seed phrase", true);
  }

  try {
    // Check if wallet already exists in either network DB
    const existsMainnet = await namedWalletExistsInDb(trimmedName, "bitcoincash");
    const existsChipnet = await namedWalletExistsInDb(trimmedName, "bchtest");
    if (existsMainnet || existsChipnet) {
      return makeError(`Wallet "${trimmedName}" already exists`, true);
    }

    const store = useStore();
    const settingsStore = useSettingsStore();

    const fullDerivationPath = DERIVATION_PATHS[derivationPath].full;

    const walletId = `seed:mainnet:${seedPhrase}:${fullDerivationPath}`;
    await Wallet.replaceNamed(trimmedName, walletId);

    const walletIdTestnet = `seed:testnet:${seedPhrase}:${fullDerivationPath}`;
    await TestNetWallet.replaceNamed(trimmedName, walletIdTestnet);

    const mainnetWallet = await Wallet.named(trimmedName);

    // Update store state
    store.activeWalletName = trimmedName;
    localStorage.setItem('activeWalletName', trimmedName);
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
      return makeError("Storage full - unable to save wallet. Check browser storage settings.", false);
    }
    if (typeof error === 'string') {
      return makeError(error, true);
    }
    return makeError("Not a valid seed phrase", false);
  }
}
