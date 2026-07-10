import { WizSignTransactionRequestSchema } from "../src/utils/zodValidation";

// A representative sign_transaction_request payload as produced by the WizardConnect
// reference serializer: hex strings for bytes, "<bigint: Xn>" for amounts
const baseRequest = {
  action: "sign_transaction_request",
  time: 1750000000,
  sequence: 1,
  inputPaths: [
    [0, "receive", 0],
    [1, "defi", 5],
  ],
  transaction: {
    transaction: "0200000001aa00000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000160014000000000000000000000000000000000000000000000000",
    sourceOutputs: [
      {
        outpointIndex: 0,
        outpointTransactionHash: "aa".repeat(32),
        sequenceNumber: 0,
        unlockingBytecode: "",
        lockingBytecode: "76a914000000000000000000000000000000000000000088ac",
        valueSatoshis: "<bigint: 10000n>",
      },
    ],
    broadcast: true,
    userPrompt: "Test transaction",
  },
};

// helper to tamper with a fresh copy of the request
const tamperedRequest = (tamper: (request: typeof baseRequest) => void) => {
  const request = structuredClone(baseRequest);
  tamper(request);
  return request;
};

describe('WizardConnect sign request schema validation', () => {
  it('should accept a request in the reference wire format and transform the fields', () => {
    const parsed = WizSignTransactionRequestSchema.parse(baseRequest);
    expect(parsed.sequence).toBe(1);
    const sourceOutput = parsed.transaction.sourceOutputs[0]!;
    expect(sourceOutput.valueSatoshis).toBe(10000n);
    expect(sourceOutput.lockingBytecode).toBeInstanceOf(Uint8Array);
    expect(sourceOutput.outpointTransactionHash).toBeInstanceOf(Uint8Array);
    expect(sourceOutput.outpointTransactionHash).toHaveLength(32);
  })
  it('should accept the extended stringified Uint8Array form', () => {
    const request = tamperedRequest((request) => {
      request.transaction.sourceOutputs[0]!.lockingBytecode = "<Uint8Array: 0x76a914000000000000000000000000000000000000000088ac>";
    });
    const parsed = WizSignTransactionRequestSchema.parse(request);
    expect(parsed.transaction.sourceOutputs[0]!.lockingBytecode).toBeInstanceOf(Uint8Array);
  })
  it('should default missing nft capability and commitment on token outputs', () => {
    const request = tamperedRequest((request) => {
      (request.transaction.sourceOutputs[0] as Record<string, unknown>).token = {
        category: "bb".repeat(32),
        amount: "<bigint: 0n>",
        nft: {},
      };
    });
    const parsed = WizSignTransactionRequestSchema.parse(request);
    const token = parsed.transaction.sourceOutputs[0]!.token!;
    expect(token.nft!.capability).toBe("none");
    expect(token.nft!.commitment).toBeInstanceOf(Uint8Array);
    expect(token.nft!.commitment).toHaveLength(0);
  })
  it('should reject an unknown inputPaths path name', () => {
    const request = tamperedRequest((request) => {
      request.inputPaths[0]![1] = "stealth_scan";
    });
    expect(() => WizSignTransactionRequestSchema.parse(request)).toThrow();
  })
  it('should reject duplicate input indices in inputPaths', () => {
    const request = tamperedRequest((request) => {
      request.inputPaths = [[0, "receive", 0], [0, "change", 1]];
    });
    expect(() => WizSignTransactionRequestSchema.parse(request)).toThrow();
  })
  it('should reject an address index beyond the BIP32 non-hardened range', () => {
    const request = tamperedRequest((request) => {
      request.inputPaths[0]![2] = 2 ** 31;
    });
    expect(() => WizSignTransactionRequestSchema.parse(request)).toThrow();
  })
  it('should reject odd-length hex in byte fields', () => {
    const request = tamperedRequest((request) => {
      request.transaction.sourceOutputs[0]!.lockingBytecode = "76a";
    });
    expect(() => WizSignTransactionRequestSchema.parse(request)).toThrow();
  })
  it('should reject a non-32-byte outpointTransactionHash', () => {
    const request = tamperedRequest((request) => {
      request.transaction.sourceOutputs[0]!.outpointTransactionHash = "deadbeef";
    });
    expect(() => WizSignTransactionRequestSchema.parse(request)).toThrow();
  })
  it('should reject a request without sourceOutputs', () => {
    const request = tamperedRequest((request) => {
      request.transaction.sourceOutputs = [];
    });
    expect(() => WizSignTransactionRequestSchema.parse(request)).toThrow();
  })
  it('should reject a missing sequence', () => {
    const request = tamperedRequest((request) => {
      delete (request as Record<string, unknown>).sequence;
    });
    expect(() => WizSignTransactionRequestSchema.parse(request)).toThrow();
  })
})
