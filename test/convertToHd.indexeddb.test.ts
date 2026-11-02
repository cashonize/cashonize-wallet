import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { vi } from "vitest";
import { IndexedDBProvider } from "@cashonize/bch-wallet-lib/indexeddb";
import { BaseWallet, DefaultProvider, HDWallet, Wallet, getNamedWalletId, saveNamedWallet } from "@cashonize/bch-wallet-lib";
import { storeSeedWalletAsHd } from "../src/utils/wallet/walletUtils";

// the conversion is storage only; the stores belong to the flow around it
vi.mock("src/stores/store", () => ({ useStore: vi.fn() }));
vi.mock("src/stores/settingsStore", () => ({ useSettingsStore: vi.fn() }));

BaseWallet.StorageProvider = IndexedDBProvider;

const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  // unroutable, so constructing a wallet cannot reach anything or depend on the network
  DefaultProvider.servers.mainnet = ["wss://127.0.0.1:1"];
});

// The address each stored id opens to, derived by the library from the row as it is stored
async function singleAddress(walletId: string): Promise<string> {
  const wallet = await Wallet.fromId(walletId);
  const address = wallet.getDepositAddress();
  await wallet.stop();
  return address;
}
async function firstHdReceiveAddress(walletId: string): Promise<string> {
  const wallet = await HDWallet.fromId(walletId);
  const address = wallet.getDepositAddress(0);
  await wallet.stop();
  return address;
}

describe('storeSeedWalletAsHd', () => {
  it.each([
    ["m/44'/145'/0'/0/0", "m/44'/145'/0'"],
    ["m/44'/0'/0'/0/0", "m/44'/0'/0'"],
  ])('stores the HD wallet on the account of %s, whose first receive address is the single address', async (fullPath, accountPath) => {
    const seedId = `seed:mainnet:${mnemonic}:${fullPath}`;
    await saveNamedWallet("mine", seedId, "bitcoincash");

    const result = await storeSeedWalletAsHd("mine", "mainnet");

    expect(result.success).toBe(true);
    const storedId = await getNamedWalletId("mine", "bitcoincash");
    expect(storedId).toBe(`hd:mainnet:${mnemonic}:${accountPath}:0:0`);
    expect(await firstHdReceiveAddress(storedId!)).toBe(await singleAddress(seedId));
  });

  it.each([
    ["an HD wallet", `hd:mainnet:${mnemonic}:m/44'/145'/0':0:0`],
    ["a private key wallet", "wif:mainnet:KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn"],
    ["a path that is not one of the three", `seed:mainnet:${mnemonic}:m/44'/145'/1'/0/0`],
  ])('leaves %s untouched', async (_kind, walletId) => {
    await saveNamedWallet("mine", walletId, "bitcoincash");

    const result = await storeSeedWalletAsHd("mine", "mainnet");

    expect(result.success).toBe(false);
    expect(await getNamedWalletId("mine", "bitcoincash")).toBe(walletId);
  });

  it('refuses while the wallet has a tied chipnet copy', async () => {
    const seedId = `seed:mainnet:${mnemonic}:m/44'/145'/0'/0/0`;
    await saveNamedWallet("mine", seedId, "bitcoincash");
    await saveNamedWallet("mine", seedId.replace(":mainnet:", ":testnet:"), "bchtest");

    const result = await storeSeedWalletAsHd("mine", "mainnet");

    expect(result.success).toBe(false);
    expect(await getNamedWalletId("mine", "bitcoincash")).toBe(seedId);
  });
});
