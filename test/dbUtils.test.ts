import { walletCacheKey } from "../src/utils/wallet/dbUtils";

// mainnet-js keys its wallet cache by sha256(`${mnemonic + derivation}-${network}`) for HD
// wallets (or the extended key alone when there is no mnemonic), and by
// sha256(`${cashaddr}-${network}`) for single-address wallets. The expected hashes below were
// produced independently with node's own crypto rather than through libauth, so these pin the
// derivation itself and not just our implementation of it.
//
// A version bump changing mainnet-js's own derivation is caught separately, by the contract
// tests in dbUtils.indexeddb.test.ts that compare this against real wallets' cache entries.
const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const derivation = "m/44'/145'/0'";
const xpriv = "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi";

describe('walletCacheKey', () => {
  it('derives the cache key of a mnemonic wallet from the mnemonic and derivation path', () => {
    const storedWalletId = `hd:mainnet:${mnemonic}:${derivation}:0:0`;
    expect(walletCacheKey(storedWalletId))
      .toBe("walletCache-d3218b82dd00c91c6b38057db7420c700f4c472944a6e3da9036531eafc01dd5");
  });

  it('derives a different key per network, so both of a wallet\'s entries are found', () => {
    const mainnetKey = walletCacheKey(`hd:mainnet:${mnemonic}:${derivation}:0:0`);
    const testnetKey = walletCacheKey(`hd:testnet:${mnemonic}:${derivation}:0:0`);
    expect(testnetKey)
      .toBe("walletCache-0b100d263ab20d413c47655ca198bdaaa3d9ea7ac8982fad80f43d8e5ab7cb6b");
    expect(mainnetKey).not.toBe(testnetKey);
  });

  it('hashes the extended key alone when the wallet has no mnemonic', () => {
    // this shape carries no derivation path, the field after the key is the deposit index
    const storedWalletId = `hd:mainnet:${xpriv}:0:0`;
    expect(walletCacheKey(storedWalletId))
      .toBe("walletCache-b7bc7594d73e33d3a53f1ba0160136e1671f8ff02662b2c4619ecee99c5654e1");
  });

  it('derives the cache key of a single-address wallet from its address', () => {
    // the address mainnet-js hashes here is the published BIP44 test vector for this mnemonic
    // at m/44'/145'/0'/0/0, bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6, so the
    // expected key pins the address derivation too and not just the hashing
    expect(walletCacheKey(`seed:mainnet:${mnemonic}:${derivation}/0/0`))
      .toBe("walletCache-2b3be2e0debde6259095f23ac475cec08c91988ec6a50037809d3addbba7ff9e");
    expect(walletCacheKey(`seed:testnet:${mnemonic}:${derivation}/0/0`))
      .toBe("walletCache-638385f59dcf5bb8782dd01b9c3cb289f49b9bbbc65f09b3325a06cf15ec8231");
  });

  it('returns nothing for a record kind the app never creates', () => {
    expect(walletCacheKey(`watch:mainnet:bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6`)).toBe(undefined);
  });

  it('returns nothing for a malformed id rather than a key that matches nothing', () => {
    expect(walletCacheKey("hd:mainnet")).toBe(undefined);
    expect(walletCacheKey(`seed:mainnet:${mnemonic}`)).toBe(undefined);
    expect(walletCacheKey("")).toBe(undefined);
  });
});
