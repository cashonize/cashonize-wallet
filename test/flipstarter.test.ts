import {
  hexToBin,
  binToHex,
  hash256,
  secp256k1,
  SigningSerializationFlag,
  generateSigningSerializationBch,
  cashAddressToLockingBytecode,
  encodeCashAddress,
  hash160,
  type CompilationContextBch,
  type TransactionCommon,
} from "@bitauth/libauth";
import type { Utxo } from "mainnet-js";
import {
  decodeFlipstarterTemplate,
  createPledgeCommitment,
  templateOutputTotal,
  isTemplateExpired,
} from "../src/utils/tools/flipstarter";

// Both addresses are derived rather than written out, so the test cannot be tripped by a
// hand-copied cashaddr checksum
const addressForKey = (keyHex: string) => {
  const key = hexToBin(keyHex);
  const pubkey = secp256k1.derivePublicKeyCompressed(key) as Uint8Array;
  const { address } = encodeCashAddress({ prefix: "bitcoincash", type: "p2pkh", payload: hash160(pubkey) });
  return { key, pubkey, address };
};
const lockingBytecodeOf = (address: string) =>
  (cashAddressToLockingBytecode(address) as { bytecode: Uint8Array }).bytecode;

const pledgeKey = addressForKey("0000000000000000000000000000000000000000000000000000000000000001");
const privateKey = pledgeKey.key;
const publicKey = pledgeKey.pubkey;
const pledgeAddress = pledgeKey.address;

const recipientAddress = addressForKey("0000000000000000000000000000000000000000000000000000000000000002").address;
const pledgeTxid = "a".repeat(64);

const templateObject = {
  outputs: [{ address: recipientAddress, value: 100_000 }],
  donation: { amount: 40_000 },
  expires: 4_000_000_000,
  data: { alias: "someone", comment: "good luck" },
};

const encodeTemplate = (object: unknown) => btoa(JSON.stringify(object));

const pledgeUtxo = {
  txid: pledgeTxid,
  vout: 1,
  satoshis: 40_000n,
  address: pledgeAddress,
} as Utxo;

const signingKey = { privateKey, pubkeyCompressed: publicKey };
const pledgeData = { alias: "someone", comment: "good luck" };

const decodeCommitment = (commitment: string) =>
  JSON.parse(atob(commitment)) as {
    inputs: {
      previous_output_transaction_hash: string;
      previous_output_index: number;
      sequence_number: number;
      unlocking_script: string;
    }[];
    data: { alias: string; comment: string };
    data_signature: null;
  };

describe('decodeFlipstarterTemplate', () => {
  it('decodes a well-formed template', () => {
    const template = decodeFlipstarterTemplate(encodeTemplate(templateObject));
    expect(template.donation.amount).toBe(40_000n);
    expect(template.outputs[0]?.value).toBe(100_000n);
    expect(template.expires).toBe(4_000_000_000);
    expect(template.data.alias).toBe("someone");
  });

  // Campaign frontends do not agree on an encoding, and a live one was found emitting UTF-16LE.
  // The Electron Cash plugin never noticed because Python's json.loads sniffs the encoding of the
  // bytes it is handed; atob and JSON.parse do not, so every request from such a campaign was
  // rejected as unreadable.
  it('decodes a request encoded as UTF-16, either byte order', () => {
    for (const littleEndian of [true, false]) {
      const json = JSON.stringify(templateObject);
      const bytes = new Uint8Array(json.length * 2);
      for (let index = 0; index < json.length; index++) {
        const code = json.charCodeAt(index);
        bytes[index * 2 + (littleEndian ? 0 : 1)] = code & 0xff;
        bytes[index * 2 + (littleEndian ? 1 : 0)] = code >> 8;
      }
      const template = decodeFlipstarterTemplate(btoa(String.fromCharCode(...bytes)));
      expect(template.donation.amount).toBe(40_000n);
      expect(template.outputs[0]?.address).toBe(recipientAddress);
    }
  });

  it('accepts satoshi values as int, whole float or string', () => {
    const asStrings = { ...templateObject, donation: { amount: "40000" }, outputs: [{ address: recipientAddress, value: "100000" }] };
    expect(decodeFlipstarterTemplate(encodeTemplate(asStrings)).donation.amount).toBe(40_000n);
    const asFloats = { ...templateObject, donation: { amount: 40000.0 } };
    expect(decodeFlipstarterTemplate(encodeTemplate(asFloats)).donation.amount).toBe(40_000n);
  });

  it('rejects a fractional satoshi value rather than rounding it', () => {
    const fractional = { ...templateObject, donation: { amount: 40000.5 } };
    expect(() => decodeFlipstarterTemplate(encodeTemplate(fractional))).toThrow();
  });

  it('rejects zero and negative amounts', () => {
    expect(() => decodeFlipstarterTemplate(encodeTemplate({ ...templateObject, donation: { amount: 0 } }))).toThrow();
    expect(() => decodeFlipstarterTemplate(encodeTemplate({ ...templateObject, donation: { amount: -1 } }))).toThrow();
  });

  // this is what stops a template asking the user to sign away more than the campaign shows
  it('rejects a donation larger than the sum of the outputs', () => {
    const tooLarge = { ...templateObject, donation: { amount: 100_001 } };
    expect(() => decodeFlipstarterTemplate(encodeTemplate(tooLarge))).toThrow();
  });

  it('rejects empty outputs, missing fields and non-base64 input', () => {
    expect(() => decodeFlipstarterTemplate(encodeTemplate({ ...templateObject, outputs: [] }))).toThrow();
    expect(() => decodeFlipstarterTemplate(encodeTemplate({ outputs: templateObject.outputs }))).toThrow();
    expect(() => decodeFlipstarterTemplate("not base64 at all !!")).toThrow();
    expect(() => decodeFlipstarterTemplate("")).toThrow();
  });

  // Without this the template passes, the address renders on the review screen, and only signing
  // fails, by which point the preparation transaction has been broadcast and its fee paid
  it('rejects a recipient address that is not a valid cashaddr', () => {
    const badChecksum = recipientAddress.slice(0, -1) + (recipientAddress.endsWith("q") ? "p" : "q");
    expect(() => decodeFlipstarterTemplate(encodeTemplate({
      ...templateObject, outputs: [{ address: badChecksum, value: 100_000 }],
    }))).toThrow();
    expect(() => decodeFlipstarterTemplate(encodeTemplate({
      ...templateObject, outputs: [{ address: "not an address", value: 100_000 }],
    }))).toThrow();
  });

  // Electron Cash accepts a cashaddr without its prefix, so a campaign may well emit one
  it('accepts a recipient address without its prefix, and prefixes it', () => {
    const bareAddress = recipientAddress.split(":")[1] as string;
    const template = decodeFlipstarterTemplate(encodeTemplate({
      ...templateObject, outputs: [{ address: bareAddress, value: 100_000 }],
    }));
    expect(template.outputs[0]?.address).toBe(recipientAddress);
  });

  it('keeps unknown fields out rather than failing on them', () => {
    const withExtras = { ...templateObject, campaignName: "ignored", nested: { a: 1 } };
    expect(() => decodeFlipstarterTemplate(encodeTemplate(withExtras))).not.toThrow();
  });
});

describe('createPledgeCommitment', () => {
  const template = decodeFlipstarterTemplate(encodeTemplate(templateObject));

  it('serializes the outpoint, sequence and data the backend expects', () => {
    const commitment = decodeCommitment(createPledgeCommitment(template, pledgeUtxo, signingKey, pledgeData));
    expect(commitment.inputs).toHaveLength(1);
    expect(commitment.inputs[0]?.previous_output_transaction_hash).toBe(pledgeTxid);
    expect(commitment.inputs[0]?.previous_output_index).toBe(1);
    expect(commitment.inputs[0]?.sequence_number).toBe(0xffffffff);
    expect(commitment.data).toEqual(pledgeData);
    expect(commitment.data_signature).toBeNull();
  });

  // The whole pledge is worthless if this signature does not verify, and the user has already
  // paid for the preparation transaction by the time a backend would tell them.
  it('produces a signature that verifies against the pledge sighash', () => {
    const commitment = decodeCommitment(createPledgeCommitment(template, pledgeUtxo, signingKey, pledgeData));
    const unlockingBytecode = hexToBin(commitment.inputs[0]!.unlocking_script);

    // scriptSig is <push sig><push pubkey>; the first byte of each push is its length
    const signatureLength = unlockingBytecode[0]!;
    const signatureWithHashType = unlockingBytecode.slice(1, 1 + signatureLength);
    const pubkeyLength = unlockingBytecode[1 + signatureLength]!;
    const pubkey = unlockingBytecode.slice(2 + signatureLength, 2 + signatureLength + pubkeyLength);

    expect(binToHex(pubkey)).toBe(binToHex(publicKey));
    // the hashtype byte is appended to the signature, and must be 0xc1
    expect(signatureWithHashType[signatureWithHashType.length - 1]).toBe(0xc1);

    const signature = signatureWithHashType.slice(0, -1);
    expect(secp256k1.verifySignatureDERLowS(signature, pubkey, pledgeSighash())).toBe(true);
  });

  // ANYONECANPAY is the whole point: it zeroes hashPrevouts and hashSequence so the signature
  // survives the campaign adding every other pledger's inputs alongside this one.
  it('signs a preimage with hashPrevouts and hashSequence zeroed', () => {
    const preimage = pledgePreimage();
    // preimage layout: version (4) | hashPrevouts (32) | hashSequence (32) | ...
    // hashUtxos is absent because 0xc1 does not set the utxos flag
    expect(preimage.slice(4, 36).every((byte) => byte === 0)).toBe(true);
    expect(preimage.slice(36, 68).every((byte) => byte === 0)).toBe(true);
  });

  it('refuses a coin carrying a token, which the campaign transaction would burn', () => {
    const tokenUtxo = { ...pledgeUtxo, token: { category: "b".repeat(64), amount: 1n } } as Utxo;
    expect(() => createPledgeCommitment(template, tokenUtxo, signingKey, pledgeData)).toThrow();
  });

  it('refuses a coin whose value is not exactly the donation amount', () => {
    const wrongValue = { ...pledgeUtxo, satoshis: 40_001n };
    expect(() => createPledgeCommitment(template, wrongValue, signingKey, pledgeData)).toThrow();
  });

  // Rebuilt here independently of the module, so the test pins the preimage rather than
  // restating whatever the module happened to produce
  function pledgePreimage() {
    const sourceOutput = {
      lockingBytecode: lockingBytecodeOf(pledgeAddress),
      valueSatoshis: 40_000n,
    };
    const transaction: TransactionCommon = {
      version: 2,
      locktime: 0,
      inputs: [{
        outpointTransactionHash: hexToBin(pledgeTxid),
        outpointIndex: 1,
        sequenceNumber: 0xffffffff,
        unlockingBytecode: Uint8Array.of(),
      }],
      outputs: [{
        lockingBytecode: lockingBytecodeOf(recipientAddress),
        valueSatoshis: 100_000n,
      }],
    };
    const context: CompilationContextBch = { inputIndex: 0, sourceOutputs: [sourceOutput], transaction };
    return generateSigningSerializationBch(context, {
      coveredBytecode: sourceOutput.lockingBytecode,
      signingSerializationType: new Uint8Array([
        SigningSerializationFlag.allOutputs | SigningSerializationFlag.singleInput | SigningSerializationFlag.forkId,
      ]),
    });
  }

  function pledgeSighash() {
    return hash256(pledgePreimage());
  }
});

describe('template helpers', () => {
  const template = decodeFlipstarterTemplate(encodeTemplate(templateObject));

  it('totals the outputs', () => {
    expect(templateOutputTotal(template)).toBe(100_000n);
  });

  it('reports expiry against the given time', () => {
    expect(isTemplateExpired(template, 3_999_999_999)).toBe(false);
    expect(isTemplateExpired(template, 4_000_000_001)).toBe(true);
  });
});
