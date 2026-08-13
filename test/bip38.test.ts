import { describe, it, expect } from "vitest";
import { encodePrivateKeyWif } from "@bitauth/libauth";
import { decryptBip38Key, isBip38Key } from "../src/utils/bip38";

// The eight test vectors from the BIP itself:
// https://github.com/bitcoin/bips/blob/master/bip-0038.mediawiki#test-vectors
const specVectors = [
  {
    name: "no compression, no EC multiply",
    encryptedKey: "6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGg",
    passphrase: "TestingOneTwoThree",
    wif: "5KN7MzqK5wt2TP1fQCYyHBtDrXdJuXbUzm4A9rKAteGu3Qi5CVR",
    compressed: false,
  },
  {
    name: "no compression, no EC multiply, second vector",
    encryptedKey: "6PRNFFkZc2NZ6dJqFfhRoFNMR9Lnyj7dYGrzdgXXVMXcxoKTePPX1dWByq",
    passphrase: "Satoshi",
    wif: "5HtasZ6ofTHP6HCwTqTkLDuLQisYPah7aUnSKfC7h4hMUVw2gi5",
    compressed: false,
  },
  {
    name: "compression, no EC multiply",
    encryptedKey: "6PYNKZ1EAgYgmQfmNVamxyXVWHzK5s6DGhwP4J5o44cvXdoY7sRzhtpUeo",
    passphrase: "TestingOneTwoThree",
    wif: "L44B5gGEpqEDRS9vVPz7QT35jcBG2r3CZwSwQ4fCewXAhAhqGVpP",
    compressed: true,
  },
  {
    name: "compression, no EC multiply, second vector",
    encryptedKey: "6PYLtMnXvfG3oJde97zRyLYFZCYizPU5T3LwgdYJz1fRhh16bU7u6PPmY7",
    passphrase: "Satoshi",
    wif: "KwYgW8gcxj1JWJXhPSu4Fqwzfhp5Yfi42mdYmMa4XqK7NJxXUSK7",
    compressed: true,
  },
  {
    name: "EC multiply, no compression, no lot/sequence",
    encryptedKey: "6PfQu77ygVyJLZjfvMLyhLMQbYnu5uguoJJ4kMCLqWwPEdfpwANVS76gTX",
    passphrase: "TestingOneTwoThree",
    wif: "5K4caxezwjGCGfnoPTZ8tMcJBLB7Jvyjv4xxeacadhq8nLisLR2",
    compressed: false,
  },
  {
    name: "EC multiply, no compression, no lot/sequence, second vector",
    encryptedKey: "6PfLGnQs6VZnrNpmVKfjotbnQuaJK4KZoPFrAjx1JMJUa1Ft8gnf5WxfKd",
    passphrase: "Satoshi",
    wif: "5KJ51SgxWaAYR13zd9ReMhJpwrcX47xTJh2D3fGPG9CM8vkv5sH",
    compressed: false,
  },
  {
    name: "EC multiply, no compression, with lot/sequence",
    encryptedKey: "6PgNBNNzDkKdhkT6uJntUXwwzQV8Rr2tZcbkDcuC9DZRsS6AtHts4Ypo1j",
    passphrase: "MOLON LABE",
    wif: "5JLdxTtcTHcfYcmJsNVy1v2PMDx432JPoYcBTVVRHpPaxUrdtf8",
    compressed: false,
  },
  {
    name: "EC multiply, no compression, with lot/sequence, non-ASCII passphrase",
    encryptedKey: "6PgGWtx25kUg8QWvwuJAgorN6k9FbE25rv5dMRwu5SKMnfpfVe5mar2ngH",
    passphrase: "ΜΟΛΩΝ ΛΑΒΕ",
    wif: "5KMKKuUmAkiNbA3DazMQiLfDq47qs8MAEThm4yL8R2PhV1ov33D",
    compressed: false,
  },
];

// The spec has no vector for EC multiplied *and* compressed, which is what bitaddress.org and its
// forks have printed since 2016. This one was built from a fixed owner salt and seed, and what it
// decrypts to was confirmed against @asoltys/bip38, the library paytaca/paperwallet encrypts with.
const compressedEcMultiplyVector = {
  encryptedKey: "6PnTsTRAb4PwAsNVWNkSkFQ1SH6gGyqi9JyVA5gGjvgZ39XBzVoBTbk7Mw",
  passphrase: "correct horse battery staple",
  wif: "Kz6FbQ3CX6cWqN8vzcoEvQ6W129aKH5ixir9GYXBBxQaYtn5rqtj",
};

// Encrypted by @asoltys/bip38 with the passphrase in NFC form
const accentedPassphraseVector = {
  encryptedKey: "6PYTaF5crVD5chUPjHLBQRgYezXMBvoUtgFzjTgxAWiqizT1fbwYbov2SW",
  passphrase: "café pass",
  wif: "KwhMR9wCnqbX7p7YWrVsaQk3D2pUpDziNmwY9Gick2tuQvFKM63i",
};

describe("isBip38Key", () => {
  it("recognises encrypted keys of both modes", () => {
    for (const vector of specVectors) {
      expect(isBip38Key(vector.encryptedKey)).toBe(true);
    }
  });

  it("does not claim plain WIF keys", () => {
    expect(isBip38Key("L44B5gGEpqEDRS9vVPz7QT35jcBG2r3CZwSwQ4fCewXAhAhqGVpP")).toBe(false);
    expect(isBip38Key("5KN7MzqK5wt2TP1fQCYyHBtDrXdJuXbUzm4A9rKAteGu3Qi5CVR")).toBe(false);
    expect(isBip38Key("")).toBe(false);
  });
});

describe("decryptBip38Key", () => {
  it.each(specVectors)("decrypts the spec vector with $name", async (vector) => {
    const { privateKey, compressed } = await decryptBip38Key(vector.encryptedKey, vector.passphrase);
    expect(compressed).toBe(vector.compressed);
    expect(encodePrivateKeyWif(privateKey, compressed ? "mainnet" : "mainnetUncompressed")).toBe(vector.wif);
  });

  it("rejects a wrong passphrase rather than returning a random key", async () => {
    await expect(decryptBip38Key(specVectors[0]!.encryptedKey, "TestingOneTwoFour")).rejects.toThrow();
  });

  it("treats the passphrase as case sensitive", async () => {
    await expect(decryptBip38Key(specVectors[1]!.encryptedKey, "satoshi")).rejects.toThrow();
  });

  it("normalises the passphrase to NFC, so decomposed input still decrypts", async () => {
    // How macOS keyboards hand over an accented passphrase: "é" as e + combining acute
    const decomposed = accentedPassphraseVector.passphrase.normalize("NFD");
    expect(decomposed).not.toBe(accentedPassphraseVector.passphrase);
    const { privateKey } = await decryptBip38Key(accentedPassphraseVector.encryptedKey, decomposed);
    expect(encodePrivateKeyWif(privateKey, "mainnet")).toBe(accentedPassphraseVector.wif);
  });

  it("rejects keys that are not BIP38 at all", async () => {
    await expect(decryptBip38Key("not a key", "passphrase")).rejects.toThrow();
    // A valid base58check string that is not a BIP38 key (a plain WIF)
    await expect(decryptBip38Key(specVectors[0]!.wif, "passphrase")).rejects.toThrow();
  });

  it("rejects a key whose base58 checksum was corrupted", async () => {
    const corrupted = specVectors[0]!.encryptedKey.slice(0, -1) + "h";
    await expect(decryptBip38Key(corrupted, specVectors[0]!.passphrase)).rejects.toThrow();
  });
});

describe("decryptBip38Key, EC multiplied and compressed", () => {
  it("decrypts the variant paper wallet generators print today", async () => {
    const { privateKey, compressed } = await decryptBip38Key(
      compressedEcMultiplyVector.encryptedKey,
      compressedEcMultiplyVector.passphrase,
    );
    expect(compressed).toBe(true);
    expect(encodePrivateKeyWif(privateKey, "mainnet")).toBe(compressedEcMultiplyVector.wif);
  });
});
