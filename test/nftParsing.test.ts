import { hexToBin, binToHex, bigIntToVmNumber, type Output } from "@bitauth/libauth";
import { utxoToLibauthOutput } from "src/parsing/utxoConverter";
import { parseNft, getNftParsingInfo } from "src/parsing/nftParsing";
import { buildSyntheticRegistry } from "src/parsing/registryBuilder";
import type { Registry, NftCategoryField } from "src/parsing/bcmr-v2.schema";
import type { BcmrTokenMetadata } from "src/interfaces/interfaces";
import type { Utxo } from "mainnet-js";

// A minimal registry for the ParityUSD Staking Receipt, matching the structure
// from the parsable-bcmr reference implementation.
// Category ID used here is the one from the studio registry for testing purposes.
const stakingReceiptCategoryId =
  "5f3663beefecdf4f08d35717df4f9c93a5b763e75735d6c9de8d648d0d4b7857";

const stakingReceiptRegistry: Registry = {
  version: { major: 1, minor: 0, patch: 0 },
  latestRevision: "2025-01-01T00:00:00.000Z",
  registryIdentity: { name: "Test Registry" },
  identities: {
    [stakingReceiptCategoryId]: {
      "2025-01-01T00:00:00.000Z": {
        name: "ParityUSD Staking Receipt",
        token: {
          category: stakingReceiptCategoryId,
          symbol: "PUSD-STAKE",
          nfts: {
            fields: {
              stakeCreatedInPeriod: {
                name: "Creation Period",
                encoding: { type: "number" },
              },
              stakedAmount: {
                name: "Staked Amount",
                encoding: { type: "number", decimals: 2, unit: "PUSD" },
              },
            },
            parse: {
              bytecode: "006b00cf547f7c816b816b",
              types: {
                "": {
                  name: "ParityUSD Staking Receipt",
                  fields: ["stakeCreatedInPeriod", "stakedAmount"],
                },
              },
            },
          },
        },
      },
    },
  },
};

// Known staking receipt commitment: period=100, stakedAmount=50000 (500.00 PUSD)
// Format: 4-byte period (LE, fixed-width) + remaining bytes amount (VM number, LE)
// period 100 = 0x64, padded to 4 bytes LE: 64000000
// amount 50000 = 0xC350, LE: 50c3, but high bit of 0xC3 is set so needs
// padding byte to avoid negative interpretation: 50c300
const testCommitment = "6400000050c300";

describe("utxoToLibauthOutput", () => {
  it("should convert a basic UTXO without token", () => {
    const utxo: Utxo = {
      txid: "a".repeat(64),
      vout: 0,
      satoshis: 10000n,
      address: ""
    };

    const output = utxoToLibauthOutput(utxo);

    expect(output.lockingBytecode).toEqual(new Uint8Array());
    expect(output.valueSatoshis).toBe(10000n);
    expect(output.token).toBeUndefined();
  });

  it("should convert a UTXO with NFT token data", () => {
    const utxo: Utxo = {
      txid: "b".repeat(64),
      vout: 1,
      satoshis: 1000n,
      address: "",
      token: {
        category: stakingReceiptCategoryId,
        amount: 0n,
        nft: {
          capability: "none",
          commitment: testCommitment,
        },
      },
    };

    const output = utxoToLibauthOutput(utxo);

    expect(output.valueSatoshis).toBe(1000n);
    expect(output.token).toBeDefined();
    expect(output.token!.category).toEqual(hexToBin(stakingReceiptCategoryId));
    expect(output.token!.amount).toBe(0n);
    expect(output.token!.nft).toBeDefined();
    expect(output.token!.nft!.capability).toBe("none");
    expect(output.token!.nft!.commitment).toEqual(hexToBin(testCommitment));
  });

  it("should convert a UTXO with fungible token data (no NFT)", () => {
    const utxo: Utxo = {
      txid: "c".repeat(64),
      vout: 0,
      satoshis: 546n,
      address: "",
      token: {
        category: stakingReceiptCategoryId,
        amount: 100000n,
      },
    };

    const output = utxoToLibauthOutput(utxo);

    expect(output.token).toBeDefined();
    expect(output.token!.amount).toBe(100000n);
    expect(output.token!.nft).toBeUndefined();
  });
});

describe("parseNft with staking receipt registry", () => {
  function createStakingReceiptOutput(commitment: string): Output {
    return {
      lockingBytecode: new Uint8Array(),
      valueSatoshis: 10000n,
      token: {
        category: hexToBin(stakingReceiptCategoryId),
        amount: 0n,
        nft: {
          commitment: hexToBin(commitment),
          capability: "none",
        },
      },
    };
  }

  it("should parse a staking receipt commitment into named fields", () => {
    const output = createStakingReceiptOutput(testCommitment);
    const result = parseNft(output, stakingReceiptRegistry);

    expect(result.success).toBe(true);
    expect(result.nftType).toBe("");
    expect(result.nftTypeName).toBe("ParityUSD Staking Receipt");
    const namedFields = result.namedFields!;
    expect(namedFields).toHaveLength(2);

    // Check first field (stakeCreatedInPeriod)
    const periodField = namedFields[0]!;
    expect(periodField.fieldId).toBe("stakeCreatedInPeriod");
    expect(periodField.name).toBe("Creation Period");
    expect(periodField.parsedValue?.type).toBe("number");
    if (periodField.parsedValue?.type === "number") {
      expect(periodField.parsedValue.value).toBe(100n);
    }
    expect(periodField.parsedValue?.formatted).toBe("100");

    // Check second field (stakedAmount)
    const amountField = namedFields[1]!;
    expect(amountField.fieldId).toBe("stakedAmount");
    expect(amountField.name).toBe("Staked Amount");
    expect(amountField.parsedValue?.type).toBe("number");
    if (amountField.parsedValue?.type === "number") {
      expect(amountField.parsedValue.value).toBe(50000n);
    }
    expect(amountField.parsedValue?.formatted).toBe("500 PUSD");
  });

  it("should fail when output has no NFT", () => {
    const output: Output = {
      lockingBytecode: new Uint8Array(),
      valueSatoshis: 10000n,
    };
    const result = parseNft(output, stakingReceiptRegistry);

    expect(result.success).toBe(false);
    expect(result.error).toContain("No NFT found");
  });

  it("should fail when no registry is provided and no bytecode given", () => {
    const output = createStakingReceiptOutput(testCommitment);
    const result = parseNft(output);

    expect(result.success).toBe(false);
    expect(result.error).toContain("No parsing bytecode");
  });

  it("should work with end-to-end utxo conversion", () => {
    const utxo: Utxo = {
      txid: "d".repeat(64),
      vout: 0,
      satoshis: 10000n,
      address: "",
      token: {
        category: stakingReceiptCategoryId,
        amount: 0n,
        nft: {
          capability: "none",
          commitment: testCommitment,
        },
      },
    };

    const output = utxoToLibauthOutput(utxo);
    const result = parseNft(output, stakingReceiptRegistry);

    expect(result.success).toBe(true);
    expect(result.nftTypeName).toBe("ParityUSD Staking Receipt");
    const namedFields = result.namedFields!;
    expect(namedFields).toHaveLength(2);
    expect(namedFields[0]!.parsedValue?.formatted).toBe("100");
    expect(namedFields[1]!.parsedValue?.formatted).toBe("500 PUSD");
  });
});

// ========== Field encoding tests (adapted from parsable-bcmr reference) ==========

function createTestUtxo(commitment: Uint8Array): Output {
  return {
    lockingBytecode: new Uint8Array(),
    valueSatoshis: 10000n,
    token: {
      category: hexToBin("aa".repeat(32)),
      amount: 0n,
      nft: {
        commitment,
        capability: "none",
      },
    },
  };
}

function createTestRegistry(
  utxo: Output,
  fieldId: string,
  fieldName: string,
  encoding: NftCategoryField[string]["encoding"],
  typeName: string,
): Registry {
  return {
    version: { major: 0, minor: 1, patch: 0 },
    latestRevision: "2025-01-01T00:00:00.000Z",
    registryIdentity: { name: "Test" },
    identities: {
      [binToHex(utxo.token!.category)]: {
        "2025-01-01T00:00:00.000Z": {
          name: `${typeName} Test`,
          token: {
            category: binToHex(utxo.token!.category),
            symbol: "TEST",
            nfts: {
              fields: {
                [fieldId]: {
                  name: fieldName,
                  encoding,
                },
              },
              parse: {
                bytecode: "00cf517f7c6b6b",
                types: {
                  "01": {
                    name: `${typeName} NFT`,
                    fields: [fieldId],
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

describe("Field encoding and decoding", () => {
  describe("UTF-8 encoding", () => {
    it("should decode simple UTF-8 string", () => {
      const helloBytes = new TextEncoder().encode("Hello");
      const commitment = new Uint8Array([0x01, ...helloBytes]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "message", "Message", { type: "utf8" }, "Text");

      const result = parseNft(utxo, registry);

      expect(result.success).toBe(true);
      expect(result.namedFields![0]!.parsedValue?.type).toBe("utf8");
      expect(result.namedFields![0]!.parsedValue?.formatted).toBe("Hello");
    });

    it("should decode UTF-8 string containing emojis", () => {
      const emojiText = "Hello 👋🌍";
      const emojiBytes = new TextEncoder().encode(emojiText);
      const commitment = new Uint8Array([0x01, ...emojiBytes]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "text", "Text", { type: "utf8" }, "Emoji");

      const result = parseNft(utxo, registry);

      expect(result.success).toBe(true);
      expect(result.namedFields![0]!.parsedValue?.formatted).toBe(emojiText);
    });
  });

  describe("Boolean encoding", () => {
    it("should decode true value (0x01)", () => {
      const commitment = new Uint8Array([0x01, 0x01]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "flag", "Flag", { type: "boolean" }, "Boolean");

      const result = parseNft(utxo, registry);
      const parsedValue = result.namedFields![0]!.parsedValue;

      expect(result.success).toBe(true);
      expect(parsedValue?.type).toBe("boolean");
      expect(parsedValue?.formatted).toBe("true");
      expect((parsedValue as { value: boolean }).value).toBe(true);
    });

    it("should decode false value (0x00)", () => {
      const commitment = new Uint8Array([0x01, 0x00]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "flag", "Flag", { type: "boolean" }, "Boolean");

      const result = parseNft(utxo, registry);
      const parsedValue = result.namedFields![0]!.parsedValue;

      expect(result.success).toBe(true);
      expect(parsedValue?.type).toBe("boolean");
      expect(parsedValue?.formatted).toBe("false");
      expect((parsedValue as { value: boolean }).value).toBe(false);
    });
  });

  describe("Binary encoding", () => {
    it("should format binary data correctly", () => {
      const commitment = new Uint8Array([0x01, 0xaa]); // 0b10101010
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "data", "Data", { type: "binary" }, "Binary");

      const result = parseNft(utxo, registry);

      expect(result.success).toBe(true);
      expect(result.namedFields![0]!.parsedValue?.type).toBe("binary");
      expect(result.namedFields![0]!.parsedValue?.formatted).toBe("0b10101010");
    });
  });

  describe("Hex encoding", () => {
    it("should format hex data correctly", () => {
      const commitment = new Uint8Array([0x01, 0xde, 0xad, 0xbe, 0xef]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "hash", "Hash", { type: "hex" }, "Hex");

      const result = parseNft(utxo, registry);

      expect(result.success).toBe(true);
      expect(result.namedFields![0]!.parsedValue?.type).toBe("hex");
      expect(result.namedFields![0]!.parsedValue?.formatted).toBe("0xdeadbeef");
    });
  });

  describe("HTTPS-URL encoding", () => {
    it("should decode and format HTTPS URL", () => {
      const url = "example.com/path";
      const urlBytes = new TextEncoder().encode(url);
      const commitment = new Uint8Array([0x01, ...urlBytes]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "website", "Website", { type: "https-url" }, "URL");

      const result = parseNft(utxo, registry);
      const parsedValue = result.namedFields![0]!.parsedValue;

      expect(result.success).toBe(true);
      expect(parsedValue?.type).toBe("https-url");
      expect(parsedValue?.formatted).toBe("https://example.com/path");
      expect((parsedValue as { url: string }).url).toBe("https://example.com/path");
    });
  });

  describe("IPFS-CID encoding", () => {
    it("should decode and format IPFS CID", () => {
      const cid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
      const cidBytes = new TextEncoder().encode(cid);
      const commitment = new Uint8Array([0x01, ...cidBytes]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "content", "Content", { type: "ipfs-cid" }, "IPFS");

      const result = parseNft(utxo, registry);
      const parsedValue = result.namedFields![0]!.parsedValue;

      expect(result.success).toBe(true);
      expect(parsedValue?.type).toBe("ipfs-cid");
      expect(parsedValue?.formatted).toBe(`ipfs://${cid}`);
      expect((parsedValue as { cid: string }).cid).toBe(cid);
    });
  });

  describe("Locktime encoding", () => {
    it("should decode block height locktime (< 500000000)", () => {
      const blockHeightBytes = bigIntToVmNumber(850000n);
      const commitment = new Uint8Array([0x01, ...blockHeightBytes]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "unlockTime", "Unlock Time", { type: "locktime" }, "Locktime");

      const result = parseNft(utxo, registry);
      const parsedValue = result.namedFields![0]!.parsedValue;

      expect(result.success).toBe(true);
      expect(parsedValue?.type).toBe("locktime");
      expect(parsedValue?.formatted).toContain("Block");
      expect(parsedValue?.formatted).toContain("850000");
      expect((parsedValue as { blockHeight: number }).blockHeight).toBe(850000);
    });

    it("should decode timestamp locktime (>= 500000000)", () => {
      const timestampBytes = bigIntToVmNumber(1735689600n); // 2025-01-01 00:00:00 UTC
      const commitment = new Uint8Array([0x01, ...timestampBytes]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "unlockTime", "Unlock Time", { type: "locktime" }, "Locktime");

      const result = parseNft(utxo, registry);
      const parsedValue = result.namedFields![0]!.parsedValue;

      expect(result.success).toBe(true);
      expect(parsedValue?.type).toBe("locktime");
      expect(parsedValue?.formatted).toContain("2025-01-01");
      expect((parsedValue as { timestamp: number }).timestamp).toBe(1735689600);
    });
  });

  describe("Number encoding with various values", () => {
    it("should handle 0 decimals (integer)", () => {
      const valueBytes = bigIntToVmNumber(12345n);
      const commitment = new Uint8Array([0x01, ...valueBytes]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "count", "Count", { type: "number", decimals: 0 }, "Number");

      const result = parseNft(utxo, registry);
      const parsedValue = result.namedFields![0]!.parsedValue;

      expect(result.success).toBe(true);
      expect(parsedValue?.formatted).toBe("12345");
      expect((parsedValue as { value: bigint }).value).toBe(12345n);
    });

    it("should handle 8 decimals (like satoshis)", () => {
      const valueBytes = bigIntToVmNumber(100000000n); // 1.00000000
      const commitment = new Uint8Array([0x01, ...valueBytes]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "amount", "Amount", { type: "number", decimals: 8, unit: "BCH" }, "BCH");

      const result = parseNft(utxo, registry);
      const parsedValue = result.namedFields![0]!.parsedValue;

      expect(result.success).toBe(true);
      expect(parsedValue?.formatted).toBe("1 BCH");
      expect((parsedValue as { value: bigint }).value).toBe(100000000n);
    });

    it("should handle 6-byte positive value (2^47 - 1)", () => {
      const valueBytes = bigIntToVmNumber(140737488355327n);
      const commitment = new Uint8Array([0x01, ...valueBytes]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "max6", "Max 6-Byte", { type: "number" }, "Number");

      const result = parseNft(utxo, registry);
      const parsedValue = result.namedFields![0]!.parsedValue;

      expect(result.success).toBe(true);
      expect(parsedValue?.formatted).toBe("140737488355327");
      expect((parsedValue as { value: bigint }).value).toBe(140737488355327n);
    });

    it("should handle 6-byte negative value (-2^47)", () => {
      const valueBytes = bigIntToVmNumber(-140737488355328n);
      const commitment = new Uint8Array([0x01, ...valueBytes]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "min6", "Min 6-Byte", { type: "number" }, "Number");

      const result = parseNft(utxo, registry);
      const parsedValue = result.namedFields![0]!.parsedValue;

      expect(result.success).toBe(true);
      expect(parsedValue?.formatted).toBe("-140737488355328");
      expect((parsedValue as { value: bigint }).value).toBe(-140737488355328n);
    });

    it("should handle zero", () => {
      const valueBytes = bigIntToVmNumber(0n);
      const commitment = new Uint8Array([0x01, ...valueBytes]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "zero", "Zero", { type: "number" }, "Number");

      const result = parseNft(utxo, registry);
      const parsedValue = result.namedFields![0]!.parsedValue;

      expect(result.success).toBe(true);
      expect(parsedValue?.formatted).toBe("0");
      expect((parsedValue as { value: bigint }).value).toBe(0n);
    });

    it("should handle negative one", () => {
      const valueBytes = bigIntToVmNumber(-1n);
      const commitment = new Uint8Array([0x01, ...valueBytes]);
      const utxo = createTestUtxo(commitment);
      const registry = createTestRegistry(utxo, "negOne", "Negative One", { type: "number" }, "Number");

      const result = parseNft(utxo, registry);
      const parsedValue = result.namedFields![0]!.parsedValue;

      expect(result.success).toBe(true);
      expect(parsedValue?.formatted).toBe("-1");
      expect((parsedValue as { value: bigint }).value).toBe(-1n);
    });
  });
});

// ========== Multi-type registry and nftTypeDescription ==========

const multiTypeCategoryId = "aa".repeat(32);

// A registry with two types: "00" (default) and "01" (active)
const multiTypeRegistry: Registry = {
  version: { major: 1, minor: 0, patch: 0 },
  latestRevision: "2025-01-01T00:00:00.000Z",
  registryIdentity: { name: "Test Registry" },
  identities: {
    [multiTypeCategoryId]: {
      "2025-01-01T00:00:00.000Z": {
        name: "Multi Type Token",
        token: {
          category: multiTypeCategoryId,
          symbol: "MTT",
          nfts: {
            fields: {
              status: {
                name: "Status",
                encoding: { type: "hex" },
              },
            },
            parse: {
              // OP_0 OP_UTXOTOKENCOMMITMENT OP_1 OP_SPLIT OP_SWAP OP_TOALTSTACK OP_TOALTSTACK
              // Splits commitment at byte 1: first byte → type (altstack[0]), rest → field (altstack[1])
              // Unlocking OP_1 remains on main stack (exactly 1 item)
              bytecode: "00cf517f7c6b6b",
              types: {
                "00": {
                  name: "Inactive Token",
                  description: "This token has no data",
                  fields: [],
                },
                "01": {
                  name: "Active Token",
                  description: "This token is active with status data",
                  fields: ["status"],
                },
              },
            },
          },
        },
      },
    },
  },
};

function createMultiTypeOutput(commitment: string): Output {
  return {
    lockingBytecode: new Uint8Array(),
    valueSatoshis: 1000n,
    token: {
      category: hexToBin(multiTypeCategoryId),
      amount: 0n,
      nft: {
        commitment: hexToBin(commitment),
        capability: "none",
      },
    },
  };
}

describe("parseNft with multi-type registry", () => {
  it("should match type '00' for default commitment", () => {
    // commitment "00" → type byte is 0x00 → type "00", empty rest field
    const output = createMultiTypeOutput("00");
    const result = parseNft(output, multiTypeRegistry);

    expect(result.success).toBe(true);
    expect(result.nftType).toBe("00");
    expect(result.nftTypeName).toBe("Inactive Token");
    expect(result.nftTypeDescription).toBe("This token has no data");
  });

  it("should match type '01' and populate nftTypeDescription", () => {
    // commitment: type byte "01" + status byte "ff"
    const output = createMultiTypeOutput("01ff");
    const result = parseNft(output, multiTypeRegistry);

    expect(result.success).toBe(true);
    expect(result.nftType).toBe("01");
    expect(result.nftTypeName).toBe("Active Token");
    expect(result.nftTypeDescription).toBe("This token is active with status data");
    expect(result.namedFields).toHaveLength(1);
    expect(result.namedFields![0]!.fieldId).toBe("status");
    expect(result.namedFields![0]!.name).toBe("Status");
    expect(result.namedFields![0]!.parsedValue?.formatted).toBe("0xff");
  });

  it("should use generic fields for unknown type", () => {
    // commitment: type byte "02" + some data — "02" not defined in types
    const output = createMultiTypeOutput("02aabb");
    const result = parseNft(output, multiTypeRegistry);

    expect(result.success).toBe(true);
    expect(result.nftType).toBe("02");
    // Unknown type: namedFields should exist but without fieldId/name
    expect(result.namedFields).toBeDefined();
    expect(result.namedFields![0]!.fieldId).toBeUndefined();
    expect(result.namedFields![0]!.name).toBeUndefined();
  });
});

// ========== VM stack-depth tolerance ==========

describe("parseNft VM stack-depth tolerance", () => {
  const categoryId = "bb".repeat(32);

  // Bytecode that leaves 2 items on main stack + puts type on altstack.
  // This should NOT fail — we only care about the altstack.
  // OP_0 OP_TOALTSTACK OP_1 OP_1 (pushes type "" to altstack, leaves two 1s on main stack)
  const stackLeavingBytecode = "006b5151";

  const registry: Registry = {
    version: { major: 1, minor: 0, patch: 0 },
    latestRevision: "2025-01-01T00:00:00.000Z",
    registryIdentity: { name: "Test" },
    identities: {
      [categoryId]: {
        "2025-01-01T00:00:00.000Z": {
          name: "Stack Test",
          token: {
            category: categoryId,
            symbol: "ST",
            nfts: {
              parse: {
                bytecode: stackLeavingBytecode,
                types: {
                  "": { name: "Default", fields: [] },
                },
              },
            },
          },
        },
      },
    },
  };

  it("should succeed when parse bytecode leaves multiple items on main stack", () => {
    const output: Output = {
      lockingBytecode: new Uint8Array(),
      valueSatoshis: 1000n,
      token: {
        category: hexToBin(categoryId),
        amount: 0n,
        nft: {
          commitment: hexToBin("aabb"),
          capability: "none",
        },
      },
    };

    const result = parseNft(output, registry);

    // Should succeed despite VM "error" about stack depth
    expect(result.success).toBe(true);
    expect(result.nftType).toBe("");
    expect(result.nftTypeName).toBe("Default");
  });
});

// ========== buildSyntheticRegistry integration test ==========

describe("buildSyntheticRegistry end-to-end parsing", () => {
  // Simulates what the Paytaca indexer would return for PUSD Staking Receipt
  const pusdCategoryId = "5f3663beefecdf4f08d35717df4f9c93a5b763e75735d6c9de8d648d0d4b7857";

  const indexerMetadata: BcmrTokenMetadata = {
    name: "ParityUSD Staking Receipt",
    description: "A staking receipt for ParityUSD",
    token: {
      category: pusdCategoryId,
      symbol: "PUSD-STAKE",
      nfts: {
        fields: {
          stakeCreatedInPeriod: {
            name: "Creation Period",
            encoding: { type: "number" },
          },
          stakedAmount: {
            name: "Staked Amount",
            encoding: { type: "number", decimals: 2, unit: "PUSD" },
          },
        },
        parse: {
          bytecode: "006b00cf547f7c816b816b",
          types: {
            "": {
              name: "ParityUSD Staking Receipt",
              fields: ["stakeCreatedInPeriod", "stakedAmount"],
            },
          },
        },
      },
    },
    nft_type: "parsable",
    is_nft: true,
  };

  it("should build a valid Registry from indexer metadata", () => {
    const registry = buildSyntheticRegistry(pusdCategoryId, indexerMetadata);
    expect(registry).toBeDefined();
    expect(registry!.identities).toBeDefined();
    expect(registry!.identities![pusdCategoryId]).toBeDefined();

    const parsingInfo = getNftParsingInfo(registry, pusdCategoryId);
    expect(parsingInfo).not.toBeNull();
    expect(parsingInfo!.parseBytecode).toBe("006b00cf547f7c816b816b");
  });

  it("should return undefined when metadata has no parse info", () => {
    const metadataWithoutNfts: BcmrTokenMetadata = {
      name: "Simple Token",
      description: "No NFT parse info",
      token: { category: pusdCategoryId, symbol: "SIMPLE" },
    };
    const registry = buildSyntheticRegistry(pusdCategoryId, metadataWithoutNfts);
    expect(registry).toBeUndefined();
  });

  it("should parse PUSD staking receipt end-to-end with synthetic registry", () => {
    const registry = buildSyntheticRegistry(pusdCategoryId, indexerMetadata)!;

    // commitment: period=100 (4 bytes LE), amount=50000 (VM number LE)
    const commitment = "6400000050c300";
    const output: Output = {
      lockingBytecode: new Uint8Array(),
      valueSatoshis: 10000n,
      token: {
        category: hexToBin(pusdCategoryId),
        amount: 0n,
        nft: {
          commitment: hexToBin(commitment),
          capability: "none",
        },
      },
    };

    const result = parseNft(output, registry);

    expect(result.success).toBe(true);
    expect(result.nftTypeName).toBe("ParityUSD Staking Receipt");
    expect(result.namedFields).toHaveLength(2);
    expect(result.namedFields![0]!.name).toBe("Creation Period");
    expect(result.namedFields![0]!.parsedValue?.formatted).toBe("100");
    expect(result.namedFields![1]!.name).toBe("Staked Amount");
    expect(result.namedFields![1]!.parsedValue?.formatted).toBe("500 PUSD");
  });

  it("should work with utxo conversion end-to-end", () => {
    const registry = buildSyntheticRegistry(pusdCategoryId, indexerMetadata)!;

    const utxo: Utxo = {
      txid: "e".repeat(64),
      vout: 0,
      satoshis: 10000n,
      address: "",
      token: {
        category: pusdCategoryId,
        amount: 0n,
        nft: {
          capability: "none",
          commitment: "6400000050c300",
        },
      },
    };

    const output = utxoToLibauthOutput(utxo);
    const result = parseNft(output, registry);

    expect(result.success).toBe(true);
    expect(result.namedFields).toHaveLength(2);
    expect(result.namedFields![0]!.parsedValue?.formatted).toBe("100");
    expect(result.namedFields![1]!.parsedValue?.formatted).toBe("500 PUSD");
  });
});
