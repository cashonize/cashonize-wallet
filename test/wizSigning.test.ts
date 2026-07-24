import {
  binToHex,
  hexToBin,
  hash160,
  secp256k1,
  encodeLockingBytecodeP2pkh,
  encodeTransaction,
  decodeTransaction,
  createVirtualMachineBch,
  type TransactionCommon,
} from "@bitauth/libauth";
import type { WcSignTransactionRequest, WcSourceOutput } from "@bch-wc2/interfaces";
import { createSignedWizTransaction, type WizInputSigningKey } from "../src/utils/wizSigning";

// SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID, mandated by the WizardConnect spec
const expectedHashType = 0x61;

const makeKey = (fillByte: number): WizInputSigningKey => {
  const privateKey = new Uint8Array(32).fill(fillByte);
  const pubkeyCompressed = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof pubkeyCompressed === "string") throw new Error(pubkeyCompressed);
  return { privateKey, pubkeyCompressed };
};

const p2pkhLockingBytecode = (key: WizInputSigningKey) =>
  encodeLockingBytecodeP2pkh(hash160(key.pubkeyCompressed));

const key0 = makeKey(0x01);
const key1 = makeKey(0x02);

const makeP2pkhRequest = (transactionForm: "object" | "hex"): WcSignTransactionRequest => {
  const transaction: TransactionCommon = {
    version: 2,
    locktime: 0,
    inputs: [
      {
        outpointIndex: 0,
        outpointTransactionHash: new Uint8Array(32).fill(0xaa),
        sequenceNumber: 0,
        unlockingBytecode: new Uint8Array(),
      },
      {
        outpointIndex: 1,
        outpointTransactionHash: new Uint8Array(32).fill(0xbb),
        sequenceNumber: 0,
        unlockingBytecode: new Uint8Array(),
      },
    ],
    outputs: [
      {
        lockingBytecode: p2pkhLockingBytecode(key0),
        valueSatoshis: 15_000n,
      },
    ],
  };
  const sourceOutputs = [
    {
      outpointIndex: 0,
      outpointTransactionHash: new Uint8Array(32).fill(0xaa),
      sequenceNumber: 0,
      unlockingBytecode: new Uint8Array(),
      lockingBytecode: p2pkhLockingBytecode(key0),
      valueSatoshis: 10_000n,
    },
    {
      outpointIndex: 1,
      outpointTransactionHash: new Uint8Array(32).fill(0xbb),
      sequenceNumber: 0,
      unlockingBytecode: new Uint8Array(),
      lockingBytecode: p2pkhLockingBytecode(key1),
      valueSatoshis: 10_000n,
    },
  ] as WcSourceOutput[];
  return {
    transaction: transactionForm === "hex" ? binToHex(encodeTransaction(transaction)) : transaction,
    sourceOutputs,
    broadcast: false,
    userPrompt: "test",
  };
};

const inputKeys = new Map<number, WizInputSigningKey>([
  [0, key0],
  [1, key1],
]);

describe('createSignedWizTransaction', () => {
  it('should produce a fully valid transaction (verified by the libauth VM)', () => {
    const request = makeP2pkhRequest("object");
    const encodedTransaction = createSignedWizTransaction(request, inputKeys);
    const signedTransaction = decodeTransaction(encodedTransaction);
    expect(typeof signedTransaction).not.toBe("string");
    if (typeof signedTransaction === "string") return;

    const vm = createVirtualMachineBch(true);
    const result = vm.verify({
      transaction: signedTransaction,
      sourceOutputs: request.sourceOutputs,
    });
    expect(result).toBe(true);
  })
  it('should produce the same transaction for hex-form and object-form requests', () => {
    const encodedFromObject = createSignedWizTransaction(makeP2pkhRequest("object"), inputKeys);
    const encodedFromHex = createSignedWizTransaction(makeP2pkhRequest("hex"), inputKeys);
    expect(binToHex(encodedFromHex)).toBe(binToHex(encodedFromObject));
  })
  it('should sign every input with SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID', () => {
    const encodedTransaction = createSignedWizTransaction(makeP2pkhRequest("object"), inputKeys);
    const signedTransaction = decodeTransaction(encodedTransaction);
    if (typeof signedTransaction === "string") throw new Error(signedTransaction);
    for (const input of signedTransaction.inputs) {
      // P2PKH unlocking bytecode: <push sig> <push pubkey>; the sig's last byte is the hashType
      const sigPushLength = input.unlockingBytecode[0]!;
      const signature = input.unlockingBytecode.slice(1, 1 + sigPushLength);
      expect(signature[signature.length - 1]).toBe(expectedHashType);
    }
  })
  it('should leave inputs without a signing key untouched', () => {
    const request = makeP2pkhRequest("object");
    const partialKeys = new Map([[0, key0]]);
    const encodedTransaction = createSignedWizTransaction(request, partialKeys);
    const signedTransaction = decodeTransaction(encodedTransaction);
    if (typeof signedTransaction === "string") throw new Error(signedTransaction);
    expect(signedTransaction.inputs[0]!.unlockingBytecode.length).toBeGreaterThan(0);
    expect(signedTransaction.inputs[1]!.unlockingBytecode.length).toBe(0);
  })
  it('should replace sig and pubkey placeholders in contract inputs', () => {
    const request = makeP2pkhRequest("object");
    const sigPlaceholder = "41" + "00".repeat(65);
    const pubkeyPlaceholder = "21" + "00".repeat(33);
    const redeemScript = hexToBin("51"); // OP_1, stand-in redeem script
    request.sourceOutputs[1] = {
      ...request.sourceOutputs[1]!,
      unlockingBytecode: hexToBin(sigPlaceholder + pubkeyPlaceholder),
      contract: {
        abiFunction: { name: "spend" },
        redeemScript,
        artifact: { contractName: "TestContract" },
      },
    } as WcSourceOutput;
    const encodedTransaction = createSignedWizTransaction(request, inputKeys);
    const signedTransaction = decodeTransaction(encodedTransaction);
    if (typeof signedTransaction === "string") throw new Error(signedTransaction);
    const unlockingBytecodeHex = binToHex(signedTransaction.inputs[1]!.unlockingBytecode);
    expect(unlockingBytecodeHex).not.toContain("00".repeat(65));
    expect(unlockingBytecodeHex).not.toContain("00".repeat(33));
    // the inserted signature ends with the mandated hashType, followed by the pubkey push
    expect(unlockingBytecodeHex).toContain(expectedHashType.toString(16) + "21" + binToHex(key1.pubkeyCompressed));
  })
  it('should throw for a contract input with placeholders but no signing key', () => {
    const request = makeP2pkhRequest("object");
    const sigPlaceholder = "41" + "00".repeat(65);
    request.sourceOutputs[1] = {
      ...request.sourceOutputs[1]!,
      unlockingBytecode: hexToBin(sigPlaceholder),
      contract: {
        abiFunction: { name: "spend" },
        redeemScript: hexToBin("51"),
        artifact: { contractName: "TestContract" },
      },
    } as WcSourceOutput;
    expect(() => createSignedWizTransaction(request, new Map([[0, key0]]))).toThrow(/No signing key/);
  })
  it('should throw on a transaction/sourceOutputs length mismatch', () => {
    const request = makeP2pkhRequest("object");
    request.sourceOutputs.pop();
    expect(() => createSignedWizTransaction(request, inputKeys)).toThrow(/length mismatch/);
  })
})
