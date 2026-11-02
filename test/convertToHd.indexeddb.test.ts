import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { vi } from "vitest";
import { IndexedDBProvider } from "@cashonize/bch-wallet-lib/indexeddb";
import { BaseWallet, DefaultProvider, HDWallet, Wallet, getNamedWalletId, saveNamedWallet } from "@cashonize/bch-wallet-lib";
import { checkSeedWalletConvertible, storeSeedWalletAsHd } from "../src/utils/wallet/walletUtils";
import { confirmAndConvertToHd } from "../src/utils/wallet/convertToHd";
import { confirmDialog } from "../src/utils/txHelpers";
import { libraryNetwork, walletDbName, type AppNetwork } from "../src/utils/wallet/networks";

// The conversion is storage, run here against a real IndexedDB; the stores and dialogs around it
// are stand-ins, with one CashConnect session on the open wallet
const mockDisconnectAllSessions = vi.fn();
vi.mock("quasar", () => ({ Notify: { create: vi.fn() } }));
vi.mock("src/stores/store", () => ({ useStore: () => ({ activeWalletName: "mine", network: "mainnet" }) }));
vi.mock("src/stores/settingsStore", () => ({ useSettingsStore: vi.fn() }));
vi.mock("src/stores/cashconnectStore", () => ({
  useCashconnectStore: () => ({ sessions: { dapp: {} }, cashConnectWallet: { disconnectAllSessions: mockDisconnectAllSessions } }),
}));
vi.mock("src/stores/walletconnectStore", () => ({ useWalletconnectStore: () => ({ activeSessions: {} }) }));
vi.mock("src/utils/txHelpers", () => ({ confirmDialog: vi.fn() }));

BaseWallet.StorageProvider = IndexedDBProvider;

const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  // unroutable, so constructing a wallet cannot reach anything or depend on the network
  DefaultProvider.servers.mainnet = ["wss://127.0.0.1:1"];
  DefaultProvider.servers.testnet = ["wss://127.0.0.1:1"];
  vi.clearAllMocks();
});

// The address each stored id opens to, derived by the library from the row as it is stored
// a test network's wallet is constructed with its network
async function singleAddress(walletId: string, network: string): Promise<string> {
  const wallet = await Wallet.fromId(walletId, { network });
  const address = wallet.getDepositAddress();
  await wallet.stop();
  return address;
}
async function firstHdReceiveAddress(walletId: string, network: string): Promise<string> {
  const wallet = await HDWallet.fromId(walletId, { network });
  const address = wallet.getDepositAddress(0);
  await wallet.stop();
  return address;
}

async function convert(walletName: string, network: AppNetwork) {
  const check = await checkSeedWalletConvertible(walletName, network);
  if (!check.success) return check;
  return storeSeedWalletAsHd(walletName, network, check.seedId);
}

describe('storeSeedWalletAsHd', () => {
  it.each([
    ["mainnet", "m/44'/145'/0'/0/0", "m/44'/145'/0'"],
    ["mainnet", "m/44'/0'/0'/0/0", "m/44'/0'/0'"],
    ["mainnet", "m/44'/245'/0'/0/0", "m/44'/245'/0'"],
    ["chipnet", "m/44'/145'/0'/0/0", "m/44'/145'/0'"],
  ] as const)('stores the %s HD wallet on the account of %s, whose first receive address is the single address', async (network, fullPath, accountPath) => {
    const storedNetwork = libraryNetwork(network);
    const seedId = `seed:${storedNetwork}:${mnemonic}:${fullPath}`;
    await saveNamedWallet("mine", seedId, walletDbName(network));

    const result = await convert("mine", network);

    expect(result.success).toBe(true);
    const storedId = await getNamedWalletId("mine", walletDbName(network));
    expect(storedId).toBe(`hd:${storedNetwork}:${mnemonic}:${accountPath}:0:0`);
    const hdAddress = await firstHdReceiveAddress(storedId!, storedNetwork);
    expect(hdAddress).toBe(await singleAddress(seedId, storedNetwork));
  });

  it.each([
    ["an HD wallet", `hd:mainnet:${mnemonic}:m/44'/145'/0':0:0`],
    ["a private key wallet", "wif:mainnet:KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn"],
    ["a path that is not one of the three", `seed:mainnet:${mnemonic}:m/44'/145'/1'/0/0`],
  ])('leaves %s untouched', async (_kind, walletId) => {
    await saveNamedWallet("mine", walletId, "bitcoincash");

    const result = await convert("mine", "mainnet");

    expect(result.success).toBe(false);
    expect(await getNamedWalletId("mine", "bitcoincash")).toBe(walletId);
  });

  it('refuses while the wallet has a tied chipnet copy', async () => {
    const seedId = `seed:mainnet:${mnemonic}:m/44'/145'/0'/0/0`;
    await saveNamedWallet("mine", seedId, "bitcoincash");
    await saveNamedWallet("mine", seedId.replace(":mainnet:", ":testnet:"), "bchtest");

    const result = await convert("mine", "mainnet");

    expect(result.success).toBe(false);
    expect(await getNamedWalletId("mine", "bitcoincash")).toBe(seedId);
  });

  it('leaves a row that changed since it was checked', async () => {
    const seedId = `seed:mainnet:${mnemonic}:m/44'/145'/0'/0/0`;
    const otherSeedId = seedId.replace("m/44'/145'", "m/44'/0'");
    await saveNamedWallet("mine", otherSeedId, "bitcoincash");

    const result = await storeSeedWalletAsHd("mine", "mainnet", seedId);

    expect(result.success).toBe(false);
    expect(await getNamedWalletId("mine", "bitcoincash")).toBe(otherSeedId);
  });
});

describe('confirmAndConvertToHd', () => {
  it('refuses a wallet it cannot convert before asking, leaving its CashConnect sessions', async () => {
    await saveNamedWallet("mine", `hd:mainnet:${mnemonic}:m/44'/145'/0':0:0`, "bitcoincash");

    await confirmAndConvertToHd();

    expect(confirmDialog).not.toHaveBeenCalled();
    expect(mockDisconnectAllSessions).not.toHaveBeenCalled();
  });
});
