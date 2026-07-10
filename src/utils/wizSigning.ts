import {
  hexToBin,
  binToHex,
  hash256,
  secp256k1,
  SigningSerializationFlag,
  generateSigningSerializationBch,
  decodeTransaction,
  encodeTransaction,
  encodeDataPush,
  type CompilationContextBch,
} from "@bitauth/libauth"
import type { WcSignTransactionRequest } from "@bch-wc2/interfaces";

export interface WizInputSigningKey {
  privateKey: Uint8Array;
  pubkeyCompressed: Uint8Array;
}

// The WizardConnect spec mandates signing every input with SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID.
// Because the dapp selects which keys sign which inputs (inputPaths), this hashType is what makes that
// safe: the signature commits to the full transaction and all source outputs, so it cannot be grafted
// onto a different transaction and the dapp cannot misrepresent input amounts.
const wizHashType = SigningSerializationFlag.allOutputs | SigningSerializationFlag.utxos | SigningSerializationFlag.forkId;

export function createSignedWizTransaction(
  wizTransactionObj: WcSignTransactionRequest,
  inputKeys: Map<number, WizInputSigningKey>,
){
  const { transaction: wizTransactionItem, sourceOutputs } = wizTransactionObj;

  const unsignedTransaction = typeof wizTransactionItem === "string" ? decodeTransaction(hexToBin(wizTransactionItem)) : wizTransactionItem;
  // If unsignedTransaction is still a string that means decodeTransaction failed
  if(typeof unsignedTransaction == "string") {
    throw new Error("Transaction decode error: " + unsignedTransaction);
  }
  if(unsignedTransaction.inputs.length !== sourceOutputs.length) {
    throw new Error("Transaction inputs and sourceOutputs length mismatch");
  }

  const signInput = (inputIndex: number, coveredBytecode: Uint8Array, privateKey: Uint8Array) => {
    const context: CompilationContextBch = { inputIndex, sourceOutputs, transaction: unsignedTransaction };
    const signingSerializationType = new Uint8Array([wizHashType]);
    const sighashPreimage = generateSigningSerializationBch(context, { coveredBytecode, signingSerializationType });
    const sighash = hash256(sighashPreimage);
    const signature = secp256k1.signMessageHashSchnorr(privateKey, sighash);
    if (typeof signature === "string") {
      throw new Error("Signature error: " + signature);
    }
    return Uint8Array.from([...signature, wizHashType]);
  };

  for (const [index, input] of unsignedTransaction.inputs.entries()) {
    const correspondingSourceOutput = sourceOutputs[index] as (typeof sourceOutputs)[number];
    const signingKey = inputKeys.get(index);

    if (correspondingSourceOutput.contract?.artifact.contractName) {
      // contract input: replace the sig and pubkey placeholders in the provided unlocking bytecode

      let unlockingBytecodeHex = binToHex(correspondingSourceOutput.unlockingBytecode);
      const sigPlaceholder = "41" + binToHex(Uint8Array.from(Array(65)));
      const pubkeyPlaceholder = "21" + binToHex(Uint8Array.from(Array(33)));
      if (unlockingBytecodeHex.indexOf(sigPlaceholder) !== -1) {
        if (!signingKey) {
          throw new Error(`No signing key provided in inputPaths for contract input ${index}`);
        }
        // coveredBytecode is the encoded script being executed, used by libauth for sighash computation
        const coveredBytecode = correspondingSourceOutput.contract?.redeemScript;
        if (!coveredBytecode) {
          throw new Error("Not enough information provided, please include contract redeemScript");
        }
        const signature = signInput(index, coveredBytecode, signingKey.privateKey);
        unlockingBytecodeHex = unlockingBytecodeHex.replace(sigPlaceholder, "41" + binToHex(signature));
      }
      if (unlockingBytecodeHex.indexOf(pubkeyPlaceholder) !== -1) {
        if (!signingKey) {
          throw new Error(`No signing key provided in inputPaths for contract input ${index}`);
        }
        unlockingBytecodeHex = unlockingBytecodeHex.replace(pubkeyPlaceholder, "21" + binToHex(signingKey.pubkeyCompressed));
      }
      input.unlockingBytecode = hexToBin(unlockingBytecodeHex);
    } else if (signingKey) {
      // P2PKH input the dapp asked us to sign (listed in inputPaths).
      // For P2PKH the coveredBytecode is the locking script itself. The derived key is not checked
      // against the locking bytecode: with SIGHASH_UTXOS a wrong-key signature is simply invalid.
      const signature = signInput(index, correspondingSourceOutput.lockingBytecode, signingKey.privateKey);
      input.unlockingBytecode = Uint8Array.from([
        ...encodeDataPush(signature),
        ...encodeDataPush(signingKey.pubkeyCompressed),
      ]);
    }
    // inputs without a signing key keep their dapp-provided unlocking bytecode
  }

  return encodeTransaction(unsignedTransaction);
}
