import {
  hexToBin,
  binToHex,
  encodeTransaction,
  decodeTransaction,
  encodeDataPush,
  secp256k1,
} from "@bitauth/libauth"
import { HDWallet } from "@cashonize/bch-wallet-lib";
import type { WcSignTransactionRequest } from "@bch-wc2/interfaces";
import type { WalletType } from "src/interfaces/interfaces";
import { i18n } from "src/boot/i18n";
import { signInput } from "./signInput";
const { t } = i18n.global

// The key of the address the dapp was given at pairing, refused when the wallet does not have it:
// a wrong record of whose session this is must not sign with another wallet's key. Branches on
// instanceof, not the wallet-type setting, which a switch can leave out of step.
export function sessionSigningKeys(wallet: WalletType, sessionAddress: string | undefined) {
  if (!sessionAddress) throw new Error(t('walletConnect.errors.noAddressForSession'));
  if (wallet instanceof HDWallet) {
    const cacheEntry = wallet.walletCache.get(sessionAddress);
    if (!cacheEntry) throw new Error(t('walletConnect.errors.addressNotInHdCache', { address: sessionAddress }));
    if (!cacheEntry.privateKey) throw new Error(t('walletConnect.errors.noPrivateKeyForAddress'));
    const pubkeyCompressed = secp256k1.compressPublicKey(cacheEntry.publicKey);
    if (typeof pubkeyCompressed === 'string') throw new Error(t('walletConnect.errors.failedToCompressPublicKey'));
    return {
      privateKey: cacheEntry.privateKey,
      pubkeyCompressed,
      publicKeyHash: cacheEntry.publicKeyHash,
    };
  }
  if (!wallet.hasAddress(sessionAddress)) throw new Error(t('walletConnect.errors.sessionAddressNotInWallet', { address: sessionAddress }));
  if (!wallet.privateKey || !wallet.publicKeyCompressed) throw new Error(t('walletConnect.errors.noPrivateKeyForAddress'));
  return {
    privateKey: wallet.privateKey,
    pubkeyCompressed: wallet.publicKeyCompressed,
    publicKeyHash: wallet.publicKeyHash,
  };
}

export function createSignedWcTransaction(
  wcTransactionObj: WcSignTransactionRequest,
  signingInfo: { privateKey: Uint8Array, pubkeyCompressed: Uint8Array },
  walletLockingBytecodeHex: string,
){
  const { transaction: wcTransactionItem, sourceOutputs } = wcTransactionObj;
  const { privateKey, pubkeyCompressed } = signingInfo;

  const unsignedTransaction = typeof wcTransactionItem === "string" ? decodeTransaction(hexToBin(wcTransactionItem)) : wcTransactionItem;
  // If unsignedTransaction is still a string that means decodeTransaction failed
  if(typeof unsignedTransaction == "string") {
    throw new Error("Transaction template error: " + unsignedTransaction);
  }

  if(unsignedTransaction.inputs.length !== sourceOutputs.length) {
    throw new Error("Transaction inputs and sourceOutputs length mismatch");
  }

  for (const [index, input] of unsignedTransaction.inputs.entries()) {
    const correspondingSourceOutput = sourceOutputs[index] as (typeof sourceOutputs)[number];
    const context = { inputIndex: index, sourceOutputs, transaction: unsignedTransaction };

    if (correspondingSourceOutput.contract?.artifact.contractName) {
      // contract input: replace the sig and pubkey placeholders in the provided unlocking bytecode
      let unlockingBytecodeHex = binToHex(correspondingSourceOutput.unlockingBytecode);
      const sigPlaceholder = "41" + binToHex(new Uint8Array(65));
      const pubkeyPlaceholder = "21" + binToHex(new Uint8Array(33));
      if (unlockingBytecodeHex.indexOf(sigPlaceholder) !== -1) {
        const coveredBytecode = correspondingSourceOutput.contract?.redeemScript;
        if (!coveredBytecode) {
          throw new Error("Not enough information provided, please include contract redeemScript");
        }
        // the loose schema lets a redeemScript through as CashScript chunks, which cannot be signed for
        if (!(coveredBytecode instanceof Uint8Array)) {
          throw new Error("The contract redeemScript must be bytecode to sign this input");
        }
        const signature = signInput(context, coveredBytecode, privateKey);
        unlockingBytecodeHex = unlockingBytecodeHex.replace(sigPlaceholder, "41" + binToHex(signature));
      }
      if (unlockingBytecodeHex.indexOf(pubkeyPlaceholder) !== -1) {
        unlockingBytecodeHex = unlockingBytecodeHex.replace(pubkeyPlaceholder, "21" + binToHex(pubkeyCompressed));
      }
      input.unlockingBytecode = hexToBin(unlockingBytecodeHex);
    } else if (!correspondingSourceOutput.unlockingBytecode?.length &&
      binToHex(correspondingSourceOutput.lockingBytecode) === walletLockingBytecodeHex
    ) {
      // P2PKH input of this wallet left for us to unlock; for P2PKH the covered bytecode is the locking script
      const signature = signInput(context, correspondingSourceOutput.lockingBytecode, privateKey);
      input.unlockingBytecode = Uint8Array.from([...encodeDataPush(signature), ...encodeDataPush(pubkeyCompressed)]);
    }
    // other inputs keep their dapp-provided unlocking bytecode
  }

  return encodeTransaction(unsignedTransaction);
}
