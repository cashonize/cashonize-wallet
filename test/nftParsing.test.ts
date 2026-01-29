import { hexToBin, type Output } from "@bitauth/libauth";
import { utxoIToLibauthOutput } from "src/parsing/utxoConverter";
import { parseNft } from "src/parsing/nftParsing";
import type { Registry } from "src/parsing/bcmr-v2.schema";
import type { UtxoI } from "mainnet-js";

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

describe("utxoIToLibauthOutput", () => {
  it("should convert a basic UTXO without token", () => {
    const utxo: UtxoI = {
      txid: "a".repeat(64),
      vout: 0,
      satoshis: 10000,
    };

    const output = utxoIToLibauthOutput(utxo);

    expect(output.lockingBytecode).toEqual(new Uint8Array());
    expect(output.valueSatoshis).toBe(10000n);
    expect(output.token).toBeUndefined();
  });

  it("should convert a UTXO with NFT token data", () => {
    const utxo: UtxoI = {
      txid: "b".repeat(64),
      vout: 1,
      satoshis: 1000,
      token: {
        tokenId: stakingReceiptCategoryId,
        amount: 0n,
        capability: "none",
        commitment: testCommitment,
      },
    };

    const output = utxoIToLibauthOutput(utxo);

    expect(output.valueSatoshis).toBe(1000n);
    expect(output.token).toBeDefined();
    expect(output.token!.category).toEqual(hexToBin(stakingReceiptCategoryId));
    expect(output.token!.amount).toBe(0n);
    expect(output.token!.nft).toBeDefined();
    expect(output.token!.nft!.capability).toBe("none");
    expect(output.token!.nft!.commitment).toEqual(hexToBin(testCommitment));
  });

  it("should convert a UTXO with fungible token data (no NFT)", () => {
    const utxo: UtxoI = {
      txid: "c".repeat(64),
      vout: 0,
      satoshis: 546,
      token: {
        tokenId: stakingReceiptCategoryId,
        amount: 100000n,
      },
    };

    const output = utxoIToLibauthOutput(utxo);

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

  it("should work with end-to-end utxoI conversion", () => {
    const utxo: UtxoI = {
      txid: "d".repeat(64),
      vout: 0,
      satoshis: 10000,
      token: {
        tokenId: stakingReceiptCategoryId,
        amount: 0n,
        capability: "none",
        commitment: testCommitment,
      },
    };

    const output = utxoIToLibauthOutput(utxo);
    const result = parseNft(output, stakingReceiptRegistry);

    expect(result.success).toBe(true);
    expect(result.nftTypeName).toBe("ParityUSD Staking Receipt");
    const namedFields = result.namedFields!;
    expect(namedFields).toHaveLength(2);
    expect(namedFields[0]!.parsedValue?.formatted).toBe("100");
    expect(namedFields[1]!.parsedValue?.formatted).toBe("500 PUSD");
  });
});
