// Flipstarter is an assurance contract: a pledge is a signed input, not a transaction. The wallet
// signs one coin into the campaign's outputs with SIGHASH_ANYONECANPAY, so the signature stays
// valid when the campaign adds every other pledger's inputs later. Nothing is paid until the
// campaign fills, and the coin has to stay unspent until it does (see utils/wallet/reservedUtxos).

import {
  hexToBin,
  binToHex,
  hash256,
  secp256k1,
  SigningSerializationFlag,
  generateSigningSerializationBch,
  decodeTransaction,
  encodeDataPush,
  cashAddressToLockingBytecode,
  type CompilationContextBch,
  type Input,
  type Output,
  type TransactionCommon,
} from "@bitauth/libauth";
import type { Utxo } from "mainnet-js";
import { FlipstarterTemplateSchema, type FlipstarterTemplate } from "src/utils/zodValidation";
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

// SIGHASH_ALL | SIGHASH_ANYONECANPAY | SIGHASH_FORKID. ANYONECANPAY is what makes a pledge
// combinable: it zeroes hashPrevouts and hashSequence, so the signature commits to the campaign's
// outputs and to this one input, but not to which other inputs end up alongside it.
const flipstarterHashType =
  SigningSerializationFlag.allOutputs | SigningSerializationFlag.singleInput | SigningSerializationFlag.forkId;

// The campaign combines pledges into a final transaction, so every pledge must agree on these
const pledgeTransactionVersion = 2;
const pledgeSequenceNumber = 0xffffffff;

export interface PledgeSigningKey {
  privateKey: Uint8Array;
  pubkeyCompressed: Uint8Array;
}

// Campaign frontends do not agree on an encoding: flipstarter.bcharg.com emits UTF-16LE, others
// UTF-8. The Electron Cash plugin never had to care because Python's json.loads takes bytes and
// sniffs the encoding itself, so this does the same sniff. JSON always starts with an ASCII
// character, which is what makes the null bytes around it tell the encodings apart (RFC 4627).
function decodeJsonBytes(bytes: Uint8Array): string {
  if (bytes.length < 2) return new TextDecoder('utf-8').decode(bytes);
  // a byte order mark says it outright, and the decoder drops the mark itself
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  // without one, the null byte beside that first ascii character says which side it sits on
  if (bytes[0] === 0 && bytes[1] !== 0) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes[1] === 0 && bytes[0] !== 0) return new TextDecoder('utf-16le').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

// The base64 blob the campaign frontend emits, whether pasted or fetched
export function decodeFlipstarterTemplate(payload: string): FlipstarterTemplate {
  const trimmedPayload = payload.trim();
  if (!trimmedPayload) throw new Error(t('flipstarter.errors.emptyTemplate'));

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(decodeJsonBytes(base64ToBin(trimmedPayload)));
  } catch {
    throw new Error(t('flipstarter.errors.templateNotBase64Json'));
  }

  const result = FlipstarterTemplateSchema.safeParse(parsedJson);
  if (!result.success) {
    console.error(result.error.message);
    throw new Error(t('flipstarter.errors.invalidTemplate'));
  }
  return result.data;
}

// The wallet's own utxo set trails a send, so the prepared coin is found in the transaction that
// was just built instead. Matching the value as well as the address is what makes it exact: a
// single-address wallet returns its change to the very address being matched.
export function findPledgeOutput(
  encodedTransaction: string,
  txid: string,
  address: string,
  satoshis: bigint,
): Utxo {
  const lockingBytecode = cashAddressToLockingBytecode(address);
  if (typeof lockingBytecode === "string") throw new Error(lockingBytecode);
  const expectedBytecode = binToHex(lockingBytecode.bytecode);

  const transaction = decodeTransaction(hexToBin(encodedTransaction));
  if (typeof transaction === "string") throw new Error(transaction);

  // The preparation transaction requests no token output, so the last check is only belt and braces
  const index = transaction.outputs.findIndex(output =>
    output.valueSatoshis === satoshis &&
    binToHex(output.lockingBytecode) === expectedBytecode &&
    !output.token
  );
  if (index === -1) throw new Error(t('flipstarter.errors.pledgeCoinNotFound'));

  return { txid, vout: index, satoshis, address };
}

export function templateOutputTotal(template: FlipstarterTemplate): bigint {
  return template.outputs.reduce((sum, output) => sum + output.value, 0n);
}

export function isTemplateExpired(template: FlipstarterTemplate, nowSeconds: number): boolean {
  return template.expires <= nowSeconds;
}

// Sign the pledge coin into the campaign's outputs and serialize the result as the commitment the
// user gives the campaign. The coin must hold no token: the campaign's outputs are plain P2PKH,
// so a token on this input would be burned when the campaign builds its transaction.
export function createPledgeCommitment(
  template: FlipstarterTemplate,
  pledgeUtxo: Utxo,
  signingKey: PledgeSigningKey,
  data: { alias: string; comment: string },
): string {
  if (pledgeUtxo.token) throw new Error(t('flipstarter.errors.pledgeUtxoHasToken'));
  if (pledgeUtxo.satoshis !== template.donation.amount) {
    throw new Error(t('flipstarter.errors.pledgeUtxoWrongValue'));
  }

  const pledgeInput: Input = {
    // libauth keeps outpointTransactionHash in the same order the txid is displayed in,
    // reversing it only when encoding
    outpointTransactionHash: hexToBin(pledgeUtxo.txid),
    outpointIndex: pledgeUtxo.vout,
    sequenceNumber: pledgeSequenceNumber,
    unlockingBytecode: Uint8Array.of(),
  };

  const campaignOutputs: Output[] = template.outputs.map((output) => ({
    lockingBytecode: lockingBytecodeForAddress(output.address),
    valueSatoshis: output.value,
  }));

  const pledgeSourceOutput: Output = {
    lockingBytecode: lockingBytecodeForAddress(pledgeUtxo.address),
    valueSatoshis: pledgeUtxo.satoshis,
  };

  const pledgeTransaction: TransactionCommon = {
    version: pledgeTransactionVersion,
    locktime: 0,
    inputs: [pledgeInput],
    outputs: campaignOutputs,
  };

  const context: CompilationContextBch = {
    inputIndex: 0,
    sourceOutputs: [pledgeSourceOutput],
    transaction: pledgeTransaction,
  };
  const sighashPreimage = generateSigningSerializationBch(context, {
    coveredBytecode: pledgeSourceOutput.lockingBytecode,
    signingSerializationType: new Uint8Array([flipstarterHashType]),
  });
  const sighash = hash256(sighashPreimage);

  // DER-encoded ECDSA rather than the Schnorr used everywhere else in this wallet: the flipstarter
  // backend verifies commitments with verifyDER only, stripping the hashtype byte first.
  const signature = secp256k1.signMessageHashDER(signingKey.privateKey, sighash);
  if (typeof signature === "string") throw new Error(t('flipstarter.errors.signingFailed'));

  const unlockingBytecode = Uint8Array.from([
    ...encodeDataPush(Uint8Array.from([...signature, flipstarterHashType])),
    ...encodeDataPush(signingKey.pubkeyCompressed),
  ]);

  return serializeCommitment(pledgeUtxo, unlockingBytecode, data);
}

// The shape the campaign backend expects, base64-encoded. data_signature is always null: it
// belongs to a campaign feature this wallet does not implement.
function serializeCommitment(
  pledgeUtxo: Utxo,
  unlockingBytecode: Uint8Array,
  data: { alias: string; comment: string },
): string {
  const commitment = {
    inputs: [{
      previous_output_transaction_hash: pledgeUtxo.txid,
      previous_output_index: pledgeUtxo.vout,
      sequence_number: pledgeSequenceNumber,
      unlocking_script: binToHex(unlockingBytecode),
    }],
    data: {
      alias: data.alias,
      comment: data.comment,
    },
    data_signature: null,
  };
  return binToBase64(new TextEncoder().encode(JSON.stringify(commitment)));
}

function lockingBytecodeForAddress(address: string): Uint8Array {
  const result = cashAddressToLockingBytecode(address);
  if (typeof result === "string") throw new Error(t('flipstarter.errors.invalidOutputAddress', { address }));
  return result.bytecode;
}

// btoa/atob work on binary strings, so the bytes are moved across one char code at a time rather
// than through a text decoder, which would mangle anything outside ASCII. atob also rejects the
// url-safe alphabet, hence the two replacements.
function base64ToBin(base64: string): Uint8Array {
  const binaryString = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
}

function binToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
