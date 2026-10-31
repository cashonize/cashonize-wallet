import {
  hash256,
  secp256k1,
  SigningSerializationFlag,
  generateSigningSerializationBch,
  type CompilationContextBch,
} from "@bitauth/libauth"

// Every wallet signature on a dapp-built transaction takes SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID.
// A signature commits to every input's outpoint and every output, but to what an input spends (value,
// token, script) only for its own input, unless it also takes UTXOS. The sign dialog reads every input
// from the dapp's sourceOutputs, so only with UTXOS does misdescribing any input invalidate the signature.
const hashType = SigningSerializationFlag.allOutputs | SigningSerializationFlag.utxos | SigningSerializationFlag.forkId;

// coveredBytecode is the script being executed: the locking bytecode for P2PKH, the redeem script for a contract
export function signInput(context: CompilationContextBch, coveredBytecode: Uint8Array, privateKey: Uint8Array) {
  const signingSerializationType = new Uint8Array([hashType]);
  const sighashPreimage = generateSigningSerializationBch(context, { coveredBytecode, signingSerializationType });
  const signature = secp256k1.signMessageHashSchnorr(privateKey, hash256(sighashPreimage));
  if (typeof signature === "string") {
    throw new Error("Signature error: " + signature);
  }
  return Uint8Array.from([...signature, hashType]);
}
