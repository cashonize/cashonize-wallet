import {
  hexToBin,
  binToHex,
  walletTemplateToCompilerBCH,
  secp256k1,
  hash256,
  SigningSerializationFlag,
  generateSigningSerializationBCH,
  generateTransaction,
  encodeTransaction,
  importWalletTemplate,
  walletTemplateP2pkhNonHd,
  type CompilationContextBCH,
  type TransactionCommon,
  type Input,
  type Output,
  type TransactionTemplate,
  type AuthenticationProgramState,
  type TransactionGenerationError,
} from "@bitauth/libauth"
import type { ContractInfo } from "src/interfaces/wcInterfaces";

export function createSignedWcTransaction(
  unsignedTransaction: TransactionCommon,
  sourceOutputs: (Input & Output & ContractInfo)[],
  signingInfo: { privateKey: Uint8Array, pubkeyCompressed: Uint8Array },
  walletLockingBytecodeHex: string,
){
  const { privateKey, pubkeyCompressed } = signingInfo;

  // prepare libauth template for input signing
  const walletTemplate = importWalletTemplate(walletTemplateP2pkhNonHd);
  if (typeof walletTemplate === "string") throw new Error("Transaction template error");

  // configure compiler
  const compiler = walletTemplateToCompilerBCH(walletTemplate);

  // TODO: investigate if this the correct type
  const txTemplate = {...unsignedTransaction} as TransactionTemplate<typeof compiler>;

  for (const [index, input] of txTemplate.inputs.entries()) {
    const correspondingSourceOutput = sourceOutputs[index] as (typeof sourceOutputs)[number];

    if (correspondingSourceOutput.contract?.artifact.contractName) {
      // instruct compiler to produce signatures for relevant contract inputs

      // replace pubkey and sig placeholders
      let unlockingBytecodeHex = binToHex(correspondingSourceOutput.unlockingBytecode);
      const sigPlaceholder = "41" + binToHex(Uint8Array.from(Array(65)));
      const pubkeyPlaceholder = "21" + binToHex(Uint8Array.from(Array(33)));
      if (unlockingBytecodeHex.indexOf(sigPlaceholder) !== -1) {
        // compute the signature argument
        const hashType = SigningSerializationFlag.allOutputs | SigningSerializationFlag.utxos | SigningSerializationFlag.forkId;
        const context: CompilationContextBCH = { inputIndex: index, sourceOutputs, transaction: unsignedTransaction };
        const signingSerializationType = new Uint8Array([hashType]);

        const coveredBytecode = correspondingSourceOutput.contract?.redeemScript;
        if (!coveredBytecode) {
          throw new Error("Not enough information provided, please include contract redeemScript");
        }
        const sighashPreimage = generateSigningSerializationBCH(context, { coveredBytecode, signingSerializationType });
        const sighash = hash256(sighashPreimage);
        const signature = secp256k1.signMessageHashSchnorr(privateKey, sighash);
        if (typeof signature === "string") {
          throw new Error("Signature error: " + signature);
        }
        const sig = Uint8Array.from([...signature, hashType]);

        unlockingBytecodeHex = unlockingBytecodeHex.replace(sigPlaceholder, "41" + binToHex(sig));
      }
      if (unlockingBytecodeHex.indexOf(pubkeyPlaceholder) !== -1) {
        unlockingBytecodeHex = unlockingBytecodeHex.replace(pubkeyPlaceholder, "21" + binToHex(pubkeyCompressed));
      }

      input.unlockingBytecode = hexToBin(unlockingBytecodeHex);
    } else {
      // replace unlocking bytecode for placeholder unlockers matching the wallet locking bytecode
      const inputLockingBytecodeHex = binToHex(correspondingSourceOutput.lockingBytecode);
      if (!correspondingSourceOutput.unlockingBytecode?.length && 
        inputLockingBytecodeHex === walletLockingBytecodeHex
      ) {
        input.unlockingBytecode = {
          compiler,
          data: {
            keys: { privateKeys: { key: privateKey } },
          },
          valueSatoshis: correspondingSourceOutput.valueSatoshis,
          script: "unlock",
          token: correspondingSourceOutput.token,
        }
      }
    }
  };

  // generate and encode transaction
  const generated = generateTransaction(txTemplate);
  if (!generated.success){
    // TODO: avoid typecasting to TransactionGenerationError
    const generationError = generated as TransactionGenerationError<AuthenticationProgramState>;
    throw Error(JSON.stringify(generationError, null, 2));
  }

  const encodedTransaction = encodeTransaction(generated.transaction);
  return encodedTransaction;
}