import { hdWalletCacheKey } from "../src/utils/wallet/dbUtils";

// mainnet-js keys its HD address cache by sha256(`${mnemonic + derivation}-${network}`), or by
// the extended key alone when there is no mnemonic. The expected hashes below were produced
// independently with node's own crypto rather than through libauth, so these pin the derivation
// itself and not just our implementation of it.
//
// What they do not catch is mainnet-js changing the derivation on a version bump. Nothing in a
// unit test can, since constructing an HD wallet offline never settles. That case is handled at
// runtime instead: deleteHdWalletKeyCache clears the whole store when no key matches.
const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const derivation = "m/44'/145'/0'";
const xpriv = "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi";

describe('hdWalletCacheKey', () => {
  it('derives the cache key of a mnemonic wallet from the mnemonic and derivation path', () => {
    const storedWalletId = `hd:mainnet:${mnemonic}:${derivation}:0:0`;
    expect(hdWalletCacheKey(storedWalletId))
      .toBe("walletCache-d3218b82dd00c91c6b38057db7420c700f4c472944a6e3da9036531eafc01dd5");
  });

  it('derives a different key per network, so both of a wallet\'s entries are found', () => {
    const mainnetKey = hdWalletCacheKey(`hd:mainnet:${mnemonic}:${derivation}:0:0`);
    const testnetKey = hdWalletCacheKey(`hd:testnet:${mnemonic}:${derivation}:0:0`);
    expect(testnetKey)
      .toBe("walletCache-0b100d263ab20d413c47655ca198bdaaa3d9ea7ac8982fad80f43d8e5ab7cb6b");
    expect(mainnetKey).not.toBe(testnetKey);
  });

  it('hashes the extended key alone when the wallet has no mnemonic', () => {
    // this shape carries no derivation path, the field after the key is the deposit index
    const storedWalletId = `hd:mainnet:${xpriv}:0:0`;
    expect(hdWalletCacheKey(storedWalletId))
      .toBe("walletCache-b7bc7594d73e33d3a53f1ba0160136e1671f8ff02662b2c4619ecee99c5654e1");
  });

  it('returns nothing for a single-address wallet, which caches no keys on disk', () => {
    expect(hdWalletCacheKey(`seed:mainnet:${mnemonic}:${derivation}`)).toBe(undefined);
  });

  it('returns nothing for a malformed id rather than a key that matches nothing', () => {
    expect(hdWalletCacheKey("hd:mainnet")).toBe(undefined);
    expect(hdWalletCacheKey("")).toBe(undefined);
  });
});
