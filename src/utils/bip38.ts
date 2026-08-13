import { base58ToBin, binToBase58, binToHex, hash160, secp256k1, sha256, utf8ToBin } from "@bitauth/libauth";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { ecb } from "@noble/ciphers/aes.js";
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

// BIP38 passphrase-protected private keys, as printed by paper wallet generators.
// Spec: https://github.com/bitcoin/bips/blob/master/bip-0038.mediawiki
//
// Every parameter below is fixed by the spec, including the address the checksum is taken over:
// that is always the legacy base58 "1..." address, never a cashaddr, also for keys made by BCH
// tools. The encoding carries no network marker, so an encrypted key looks the same on both
// networks and only the address it unlocks tells them apart.

// The heavy scrypt pass over the passphrase, shared by both modes
const passphraseScryptParams = { N: 16384, r: 8, p: 8 };
// The second, cheap pass in EC-multiplied mode, over the derived passpoint
const passpointScryptParams = { N: 1024, r: 1, p: 1 };

const nonEcMultipliedPrefix = 0x42;
const ecMultipliedPrefix = 0x43;
const compressedFlag = 0x20;
const lotSequenceFlag = 0x04;

export interface DecryptedBip38Key {
  privateKey: Uint8Array;
  // Whether the address this key unlocks uses the compressed public key. Encoded in the key, so
  // the caller must honour it: deriving the other form yields a different, empty address.
  compressed: boolean;
}

// Lenient check for whether an input should be treated as an encrypted key rather than a WIF.
// Anything malformed beyond the prefix is rejected by decryptBip38Key with a specific error.
export function isBip38Key(input: string): boolean {
  return input.startsWith("6P");
}

const doubleSha256 = (input: Uint8Array) => sha256.hash(sha256.hash(input));

const xor = (input: Uint8Array, key: Uint8Array) => input.map((byte, index) => byte ^ key[index]!);

const decryptAesBlock = (key: Uint8Array, block: Uint8Array) =>
  ecb(key, { disablePadding: true }).decrypt(block);

// The 4-byte salt is taken over the legacy address as a base58 *string*, not over its bytes
function legacyAddressHash(privateKey: Uint8Array, compressed: boolean) {
  const publicKey = compressed
    ? secp256k1.derivePublicKeyCompressed(privateKey)
    : secp256k1.derivePublicKeyUncompressed(privateKey);
  if (typeof publicKey === "string") throw new Error(publicKey);
  const versionedHash = Uint8Array.from([0x00, ...hash160(publicKey)]);
  const address = binToBase58(Uint8Array.from([...versionedHash, ...doubleSha256(versionedHash).slice(0, 4)]));
  return doubleSha256(utf8ToBin(address)).slice(0, 4);
}

function decodeEncryptedKey(encryptedKey: string) {
  const decoded = base58ToBin(encryptedKey);
  if (typeof decoded === "string" || decoded.length !== 43) {
    throw new Error(t('sweepPrivateKey.errors.invalidEncryptedKey'));
  }
  const payload = decoded.slice(0, 39);
  const checksum = decoded.slice(39);
  if (binToHex(doubleSha256(payload).slice(0, 4)) !== binToHex(checksum)) {
    throw new Error(t('sweepPrivateKey.errors.invalidEncryptedKey'));
  }

  const mode = payload[1];
  const flagByte = payload[2]!;
  if (payload[0] !== 0x01 || (mode !== nonEcMultipliedPrefix && mode !== ecMultipliedPrefix)) {
    throw new Error(t('sweepPrivateKey.errors.invalidEncryptedKey'));
  }
  // Only the flags the spec defines for the mode at hand may be set. Non-EC-multiplied keys
  // additionally always set the top two bits, EC-multiplied keys never do.
  const knownFlags = mode === ecMultipliedPrefix ? compressedFlag | lotSequenceFlag : compressedFlag;
  const requiredFlags = mode === ecMultipliedPrefix ? 0x00 : 0xc0;
  if ((flagByte & ~knownFlags) !== requiredFlags) {
    throw new Error(t('sweepPrivateKey.errors.invalidEncryptedKey'));
  }

  return {
    ecMultiplied: mode === ecMultipliedPrefix,
    compressed: (flagByte & compressedFlag) !== 0,
    hasLotSequence: (flagByte & lotSequenceFlag) !== 0,
    addressHash: payload.slice(3, 7),
    payload,
  };
}

// The straightforward mode: the passphrase directly encrypts an existing private key
async function decryptNonEcMultiplied(
  payload: Uint8Array,
  addressHash: Uint8Array,
  passphrase: Uint8Array,
  onProgress: (progress: number) => void,
) {
  const derived = await scryptAsync(passphrase, addressHash, { ...passphraseScryptParams, dkLen: 64, onProgress });
  const derivedHalf1 = derived.slice(0, 32);
  const derivedHalf2 = derived.slice(32);
  const firstHalf = xor(decryptAesBlock(derivedHalf2, payload.slice(7, 23)), derivedHalf1.slice(0, 16));
  const secondHalf = xor(decryptAesBlock(derivedHalf2, payload.slice(23, 39)), derivedHalf1.slice(16, 32));
  return Uint8Array.from([...firstHalf, ...secondHalf]);
}

// The mode paper wallet printers use: the key was generated from a passphrase-derived intermediate
// code, so the passphrase never reached the printer. Recovering it takes two scrypt passes.
async function decryptEcMultiplied(
  payload: Uint8Array,
  addressHash: Uint8Array,
  hasLotSequence: boolean,
  passphrase: Uint8Array,
  onProgress: (progress: number) => void,
) {
  const ownerEntropy = payload.slice(7, 15);
  // With a lot/sequence number only half of the owner entropy is salt, the rest identifies the lot
  const ownerSalt = hasLotSequence ? ownerEntropy.slice(0, 4) : ownerEntropy;
  const preFactor = await scryptAsync(passphrase, ownerSalt, { ...passphraseScryptParams, dkLen: 32, onProgress });
  const passFactor = hasLotSequence
    ? doubleSha256(Uint8Array.from([...preFactor, ...ownerEntropy]))
    : preFactor;
  const passPoint = secp256k1.derivePublicKeyCompressed(passFactor);
  if (typeof passPoint === "string") throw new Error(passPoint);

  const salt = Uint8Array.from([...addressHash, ...ownerEntropy]);
  const derived = await scryptAsync(passPoint, salt, { ...passpointScryptParams, dkLen: 64 });
  const derivedHalf1 = derived.slice(0, 32);
  const derivedHalf2 = derived.slice(32);

  // The second block has to be decrypted first: it holds the tail of the first block's ciphertext
  const secondHalf = xor(decryptAesBlock(derivedHalf2, payload.slice(23, 39)), derivedHalf1.slice(16, 32));
  const firstBlock = Uint8Array.from([...payload.slice(15, 23), ...secondHalf.slice(0, 8)]);
  const firstHalf = xor(decryptAesBlock(derivedHalf2, firstBlock), derivedHalf1.slice(0, 16));

  const seed = Uint8Array.from([...firstHalf, ...secondHalf.slice(8)]);
  const privateKey = secp256k1.mulTweakPrivateKey(passFactor, doubleSha256(seed));
  if (typeof privateKey === "string") throw new Error(privateKey);
  return privateKey;
}

/**
 * Decrypt a BIP38 encrypted private key. Deliberately slow: the spec's scrypt parameters take
 * roughly a second on desktop and several on mobile, so onProgress (0 to 1) is worth surfacing.
 * Throws a translated error when the key is malformed or the passphrase is wrong.
 */
export async function decryptBip38Key(
  encryptedKey: string,
  passphrase: string,
  onProgress: (progress: number) => void = () => undefined,
): Promise<DecryptedBip38Key> {
  const { ecMultiplied, compressed, hasLotSequence, addressHash, payload } = decodeEncryptedKey(encryptedKey);
  // Passphrases are compared as NFC, so that the same characters typed on a different keyboard
  // or platform still produce the same key
  const normalizedPassphrase = utf8ToBin(passphrase.normalize("NFC"));

  const privateKey = ecMultiplied
    ? await decryptEcMultiplied(payload, addressHash, hasLotSequence, normalizedPassphrase, onProgress)
    : await decryptNonEcMultiplied(payload, addressHash, normalizedPassphrase, onProgress);

  // A wrong passphrase decrypts to a random key rather than failing, so the key is only correct
  // if it unlocks the address the encrypted key was made for
  if (binToHex(legacyAddressHash(privateKey, compressed)) !== binToHex(addressHash)) {
    throw new Error(t('sweepPrivateKey.errors.incorrectPassphrase'));
  }

  return { privateKey, compressed };
}
