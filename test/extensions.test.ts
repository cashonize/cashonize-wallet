import { describe, it, expect, vi } from "vitest";
import { createElectrumAdapter } from "src/parsing/electrumAdapter";
import { invokeExtensions } from "src/parsing/extensions/index";
import { parseNft, type NftParseInfo } from "src/parsing/nftParsing";
import type { Output } from "@bitauth/libauth";
import { hexToBin, binToHex, encodeTransaction } from "@bitauth/libauth";
import type { IdentitySnapshot, Registry } from "src/parsing/bcmr-v2.schema";
import type { ElectrumClient, ElectrumUtxo } from "src/parsing/extensions/types";

describe("createElectrumAdapter", () => {
  it("converts Utxo format to ElectrumUtxo format", async () => {
    const mockProvider = {
      getUtxos: vi.fn().mockResolvedValue([
        {
          txid: "abc123",
          vout: 0,
          satoshis: 1000n,
          height: 800000,
          token: {
            category: "def456",
            amount: 100n,
            nft: {
              capability: "none" as const,
              commitment: "aabb",
            },
          },
        },
      ]),
      getRawTransaction: vi.fn().mockResolvedValue("deadbeef"),
    };

    const adapter = createElectrumAdapter(mockProvider);
    const utxos = await adapter.getUTXOs("bchtest:qtest");

    expect(utxos).toHaveLength(1);
    const utxo = utxos[0]!;
    expect(utxo.tx_hash).toBe("abc123");
    expect(utxo.tx_pos).toBe(0);
    expect(utxo.value).toBe(1000n);
    expect(utxo.height).toBe(800000);
    expect(utxo.token_data).toEqual({
      category: "def456",
      amount: "100",
      nft: {
        capability: "none",
        commitment: "aabb",
      },
    });
  });

  it("handles UTXOs without tokens", async () => {
    const mockProvider = {
      getUtxos: vi.fn().mockResolvedValue([
        {
          txid: "abc123",
          vout: 1,
          satoshis: 5000n,
        },
      ]),
      getRawTransaction: vi.fn(),
    };

    const adapter = createElectrumAdapter(mockProvider);
    const utxos = await adapter.getUTXOs("bchtest:qtest");

    expect(utxos).toHaveLength(1);
    const utxo = utxos[0]!;
    expect(utxo.tx_hash).toBe("abc123");
    expect(utxo.tx_pos).toBe(1);
    expect(utxo.value).toBe(5000n);
    expect(utxo.token_data).toBeUndefined();
  });

  it("passes through getRawTransaction", async () => {
    const mockProvider = {
      getUtxos: vi.fn(),
      getRawTransaction: vi.fn().mockResolvedValue("rawTxHex"),
    };

    const adapter = createElectrumAdapter(mockProvider);
    const result = await adapter.getRawTransaction("txid123");

    expect(result).toBe("rawTxHex");
    expect(mockProvider.getRawTransaction).toHaveBeenCalledWith("txid123");
  });
});

describe("invokeExtensions", () => {
  const categoryHex = "aabbccdd";
  const mockUtxo: Output = {
    lockingBytecode: new Uint8Array(),
    valueSatoshis: 1000n,
    token: {
      category: hexToBin(categoryHex),
      amount: 0n,
      nft: {
        capability: "none",
        commitment: new Uint8Array(),
      },
    },
  };

  it("returns unmodified UTXO when no extensions in identity", async () => {
    const identity: IdentitySnapshot = {
      name: "Test Token",
    };

    const mockClient = {
      getUTXOs: vi.fn(),
      getRawTransaction: vi.fn(),
    };

    const result = await invokeExtensions(mockUtxo, identity, mockClient, "bchtest");
    expect(result).toBe(mockUtxo);
  });

  it("skips disabled extensions", async () => {
    const identity: IdentitySnapshot = {
      name: "Test Token",
      extensions: {
        parityusd: {
          fetchLoanState: {
            lockingBytecode: "aa20",
          },
        },
      },
    };

    const mockClient = {
      getUTXOs: vi.fn(),
      getRawTransaction: vi.fn(),
    };

    const result = await invokeExtensions(
      mockUtxo,
      identity,
      mockClient,
      "bchtest",
      { parityusd: false },
    );

    // Should not have called any electrum methods
    expect(mockClient.getUTXOs).not.toHaveBeenCalled();
    expect(mockClient.getRawTransaction).not.toHaveBeenCalled();
    // Should return the original UTXO
    expect(result).toBe(mockUtxo);
  });
});

// ========== fetchLoanState integration tests ==========

// Hardcoded loan commitment: 27 bytes
// Format: 01 + borrowed(6) + redeemed(6) + status(1) + period(4) + rate(2) + nextRate(2) + managerConfig(5)
// Values: borrowed=1000000 (10000.00 PUSD), redeemed=0, status=02, period=100, rate=500, nextRate=500, manager=0090019001
const loanCommitmentHex = "0140420f0000000000000000000264000000f401f4010090019001";

const loanKeyCategory = "cc72dc3e00e9e36242764290cf585819231cf1e867284b415fb4290392167505";

// A p2sh32 locking bytecode for the sidecar address
const sidecarLockingBytecode = "aa20" + "bb".repeat(32) + "87";

function createLoanKeyUtxo(): Output {
  return {
    lockingBytecode: new Uint8Array(),
    valueSatoshis: 1000n,
    token: {
      category: hexToBin(loanKeyCategory),
      amount: 0n,
      nft: {
        commitment: hexToBin(""), // Empty commitment — loan key
        capability: "minting",
      },
    },
  };
}

function createIdentityWithExtension(): IdentitySnapshot {
  return {
    name: "Loan Key",
    extensions: {
      parityusd: {
        fetchLoanState: {
          lockingBytecode: sidecarLockingBytecode,
        },
      },
    },
  };
}

function createMockLoanTransaction(): string {
  const loanOutput: Output = {
    lockingBytecode: hexToBin("aa20" + "cc".repeat(32) + "87"),
    valueSatoshis: 200000n,
    token: {
      category: hexToBin("dd".repeat(32)), // Loan NFT has a different category (the parity token)
      amount: 0n,
      nft: {
        capability: "mutable",
        commitment: hexToBin(loanCommitmentHex),
      },
    },
  };

  const sidecarOutput: Output = {
    lockingBytecode: hexToBin(sidecarLockingBytecode),
    valueSatoshis: 1000n,
    token: {
      category: hexToBin(loanKeyCategory),
      amount: 0n,
      nft: {
        capability: "none",
        commitment: hexToBin(""),
      },
    },
  };

  const tx = {
    version: 2,
    inputs: [] as never[],
    outputs: [loanOutput, sidecarOutput],
    locktime: 0,
  };

  return binToHex(encodeTransaction(tx));
}

function createMockElectrumClient(): ElectrumClient {
  const mockTxHash = "ff".repeat(32);
  const mockTx = createMockLoanTransaction();

  return {
    getUTXOs(): Promise<ElectrumUtxo[]> {
      return Promise.resolve([
        {
          tx_hash: mockTxHash,
          tx_pos: 1, // Sidecar is at output index 1
          value: 1000n,
          script: sidecarLockingBytecode,
          token_data: {
            category: loanKeyCategory,
            nft: {
              capability: "none",
              commitment: "",
            },
          },
        },
      ]);
    },
    getRawTransaction(): Promise<string> {
      return Promise.resolve(mockTx);
    },
  };
}

describe("fetchLoanState via invokeExtensions", () => {
  it("should transplant loan commitment and value into loan key UTXO", async () => {
    const utxo = createLoanKeyUtxo();
    const identity = createIdentityWithExtension();
    const mockClient = createMockElectrumClient();

    const result = await invokeExtensions(utxo, identity, mockClient, "bchtest");

    // Commitment has been transplanted
    expect(binToHex(result.token!.nft!.commitment)).toBe(loanCommitmentHex);
    expect(result.token!.nft!.commitment.length).toBe(27);

    // Value has been transplanted
    expect(result.valueSatoshis).toBe(200000n);

    // Category has NOT been changed (stays as loan key category)
    expect(binToHex(result.token!.category)).toBe(loanKeyCategory);

    // Capability has NOT been changed
    expect(result.token!.nft!.capability).toBe("minting");
  });

  it("should return unmodified UTXO when no sidecar found", async () => {
    const utxo = createLoanKeyUtxo();
    const identity = createIdentityWithExtension();

    const emptyClient: ElectrumClient = {
      getUTXOs(): Promise<ElectrumUtxo[]> {
        return Promise.resolve([]);
      },
      getRawTransaction(): Promise<string> {
        return Promise.resolve("");
      },
    };

    const result = await invokeExtensions(utxo, identity, emptyClient, "bchtest");

    // Should return unmodified
    expect(result.token!.nft!.commitment.length).toBe(0);
    expect(result.valueSatoshis).toBe(1000n);
  });

  it("should return unmodified UTXO when sidecar is at index 0", async () => {
    const utxo = createLoanKeyUtxo();
    const identity = createIdentityWithExtension();

    const tx = {
      version: 2,
      inputs: [] as never[],
      outputs: [
        {
          lockingBytecode: hexToBin(sidecarLockingBytecode),
          valueSatoshis: 1000n,
          token: {
            category: hexToBin(loanKeyCategory),
            amount: 0n,
            nft: { capability: "none" as const, commitment: hexToBin("") },
          },
        },
      ],
      locktime: 0,
    };

    const indexZeroClient: ElectrumClient = {
      getUTXOs(): Promise<ElectrumUtxo[]> {
        return Promise.resolve([
          {
            tx_hash: "ff".repeat(32),
            tx_pos: 0, // Sidecar at index 0 — no previous output
            value: 1000n,
            script: sidecarLockingBytecode,
            token_data: {
              category: loanKeyCategory,
              nft: { capability: "none", commitment: "" },
            },
          },
        ]);
      },
      getRawTransaction(): Promise<string> {
        return Promise.resolve(binToHex(encodeTransaction(tx)));
      },
    };

    const result = await invokeExtensions(utxo, identity, indexZeroClient, "bchtest");

    expect(result.token!.nft!.commitment.length).toBe(0);
    expect(result.valueSatoshis).toBe(1000n);
  });

  it("should return unmodified UTXO when loan output has no NFT", async () => {
    const utxo = createLoanKeyUtxo();
    const identity = createIdentityWithExtension();

    const tx = {
      version: 2,
      inputs: [] as never[],
      outputs: [
        {
          // Loan output without any token/NFT
          lockingBytecode: hexToBin("76a914" + "00".repeat(20) + "88ac"),
          valueSatoshis: 200000n,
        },
        {
          lockingBytecode: hexToBin(sidecarLockingBytecode),
          valueSatoshis: 1000n,
          token: {
            category: hexToBin(loanKeyCategory),
            amount: 0n,
            nft: { capability: "none" as const, commitment: hexToBin("") },
          },
        },
      ],
      locktime: 0,
    };

    const noNftClient: ElectrumClient = {
      getUTXOs(): Promise<ElectrumUtxo[]> {
        return Promise.resolve([
          {
            tx_hash: "ff".repeat(32),
            tx_pos: 1,
            value: 1000n,
            script: sidecarLockingBytecode,
            token_data: {
              category: loanKeyCategory,
              nft: { capability: "none", commitment: "" },
            },
          },
        ]);
      },
      getRawTransaction(): Promise<string> {
        return Promise.resolve(binToHex(encodeTransaction(tx)));
      },
    };

    const result = await invokeExtensions(utxo, identity, noNftClient, "bchtest");

    expect(result.token!.nft!.commitment.length).toBe(0);
    expect(result.valueSatoshis).toBe(1000n);
  });
});

// ========== End-to-end loan key parsing (extension + parseNft) ==========

// Real parse bytecode from the ParityUSD loan key BCMR template.
// Checks commitment length to determine type ("" for empty, "01" for active loan with 10 fields).
// Uses OP_UTXOVALUE for the collateral field and multiplies interest rates
// by 365 to convert per-period rates to APR.
const parseBytecodeHex =
  "00ce01207f52876300cf82011b8763516b517f7c75567f7c816b00c66b567f7c816b517f7c816b547f7c816b527f7c81026d01956b527f7c81026d01956b517f7c816b527f7c81026d01956b527f7c81026d01956b67006b6867526b00cf6b68";

function createLoanKeyParseInfo(): NftParseInfo {
  return {
    bytecode: parseBytecodeHex,
    types: {
      "": {
        name: "Loan Key (no loan data)",
        description:
          "Controls a ParityUSD loan. Install the ParityUSD extension to see loan data.",
      },
      "01": {
        name: "Loan Key",
        description:
          "Controls a ParityUSD loan, including access to collateral.",
        fields: [
          "currentDebt",
          "collateral",
          "amountBeingRedeemed",
          "maturityStatus",
          "lastPeriodInterestPaid",
          "currentInterestRate",
          "nextInterestRate",
          "interestManager",
          "minRateManager",
          "maxRateManager",
        ],
      },
    },
    fields: {
      currentDebt: {
        name: "Current Debt",
        encoding: { type: "number", decimals: 2, unit: "PUSD" },
      },
      collateral: {
        name: "Collateral",
        encoding: { type: "number", decimals: 8, unit: "BCH" },
      },
      amountBeingRedeemed: {
        name: "Redeemed",
        encoding: { type: "number", decimals: 2, unit: "PUSD" },
      },
      maturityStatus: {
        name: "Maturity Status",
        encoding: { type: "hex" },
      },
      lastPeriodInterestPaid: {
        name: "Interest Paid Up To Period",
        encoding: { type: "number" },
      },
      currentInterestRate: {
        name: "Interest Rate",
        encoding: { type: "number", decimals: 5, unit: "% APR" },
      },
      nextInterestRate: {
        name: "Upcoming Interest Rate",
        encoding: { type: "number", decimals: 5, unit: "% APR" },
      },
      interestManager: {
        name: "Interest Manager",
        encoding: { type: "hex" },
      },
      minRateManager: {
        name: "Min Interest Rate",
        encoding: { type: "number", decimals: 5, unit: "% APR" },
      },
      maxRateManager: {
        name: "Max Interest Rate",
        encoding: { type: "number", decimals: 5, unit: "% APR" },
      },
    },
  };
}

describe("End-to-end loan key parsing without extension", () => {
  const parseInfo = createLoanKeyParseInfo();

  it("should parse loan key as type '' with 0 fields when commitment is empty", () => {
    const utxo = createLoanKeyUtxo();
    const result = parseNft(utxo, parseInfo);

    expect(result.success).toBe(true);
    expect(result.nftType).toBe("");
    expect(result.nftTypeName).toBe("Loan Key (no loan data)");
    expect(result.nftTypeDescription).toContain("Install the ParityUSD extension");
    expect(result.namedFields).toHaveLength(0);
  });
});

describe("End-to-end loan key parsing with extension", () => {
  const parseInfo = createLoanKeyParseInfo();

  it("should parse as type '01' with 10 named fields after extension transplant", async () => {
    const utxo = createLoanKeyUtxo();
    const identity = createIdentityWithExtension();
    const mockClient = createMockElectrumClient();

    // Step 1: Extension transplants loan commitment and value
    const modifiedUtxo = await invokeExtensions(
      utxo,
      identity,
      mockClient,
      "bchtest",
    );

    // Step 2: Parse the modified UTXO with the parse info
    const result = parseNft(modifiedUtxo, parseInfo);

    expect(result.success).toBe(true);
    expect(result.nftType).toBe("01");
    expect(result.nftTypeName).toBe("Loan Key");
    expect(result.nftTypeDescription).toContain("access to collateral");
    expect(result.namedFields).toHaveLength(10);

    // Field 0: currentDebt — 1000000 raw = 10000.00 PUSD
    const debtField = result.namedFields![0]!;
    expect(debtField.fieldId).toBe("currentDebt");
    expect(debtField.name).toBe("Current Debt");
    expect(debtField.parsedValue?.type).toBe("number");
    expect((debtField.parsedValue as { value: bigint }).value).toBe(1000000n);
    expect(debtField.parsedValue?.formatted).toBe("10000 PUSD");

    // Field 1: collateral — from UTXO value 200000 sats = 0.002 BCH
    const collateralField = result.namedFields![1]!;
    expect(collateralField.fieldId).toBe("collateral");
    expect(collateralField.name).toBe("Collateral");
    expect(collateralField.parsedValue?.type).toBe("number");
    expect((collateralField.parsedValue as { value: bigint }).value).toBe(
      200000n,
    );
    expect(collateralField.parsedValue?.formatted).toBe("0.002 BCH");

    // Field 2: amountBeingRedeemed — 0
    const redeemedField = result.namedFields![2]!;
    expect(redeemedField.fieldId).toBe("amountBeingRedeemed");
    expect((redeemedField.parsedValue as { value: bigint }).value).toBe(0n);
    expect(redeemedField.parsedValue?.formatted).toBe("0 PUSD");

    // Field 3: maturityStatus — hex "0x02"
    const statusField = result.namedFields![3]!;
    expect(statusField.fieldId).toBe("maturityStatus");
    expect(statusField.parsedValue?.type).toBe("hex");
    expect(statusField.parsedValue?.formatted).toBe("0x02");

    // Field 4: lastPeriodInterestPaid — 100
    const periodField = result.namedFields![4]!;
    expect(periodField.fieldId).toBe("lastPeriodInterestPaid");
    expect((periodField.parsedValue as { value: bigint }).value).toBe(100n);
    expect(periodField.parsedValue?.formatted).toBe("100");

    // Field 5: currentInterestRate — 500 * 365 = 182500, with 5 decimals = 1.825 % APR
    const rateField = result.namedFields![5]!;
    expect(rateField.fieldId).toBe("currentInterestRate");
    expect(rateField.name).toBe("Interest Rate");
    expect((rateField.parsedValue as { value: bigint }).value).toBe(182500n);
    expect(rateField.parsedValue?.formatted).toBe("1.825 % APR");

    // Field 6: nextInterestRate — same as current
    const nextRateField = result.namedFields![6]!;
    expect(nextRateField.fieldId).toBe("nextInterestRate");
    expect((nextRateField.parsedValue as { value: bigint }).value).toBe(
      182500n,
    );
    expect(nextRateField.parsedValue?.formatted).toBe("1.825 % APR");

    // Field 7: interestManager — hex "0x00" (unmanaged)
    const managerField = result.namedFields![7]!;
    expect(managerField.fieldId).toBe("interestManager");
    expect(managerField.parsedValue?.type).toBe("hex");
    expect(managerField.parsedValue?.formatted).toBe("0x00");

    // Field 8: minRateManager — 400 * 365 = 146000, with 5 decimals = 1.46 % APR
    const minRateField = result.namedFields![8]!;
    expect(minRateField.fieldId).toBe("minRateManager");
    expect((minRateField.parsedValue as { value: bigint }).value).toBe(146000n);
    expect(minRateField.parsedValue?.formatted).toBe("1.46 % APR");

    // Field 9: maxRateManager — same as min
    const maxRateField = result.namedFields![9]!;
    expect(maxRateField.fieldId).toBe("maxRateManager");
    expect((maxRateField.parsedValue as { value: bigint }).value).toBe(146000n);
    expect(maxRateField.parsedValue?.formatted).toBe("1.46 % APR");
  });

  it("should fall back to type '' when sidecar is missing", async () => {
    const utxo = createLoanKeyUtxo();
    const identity = createIdentityWithExtension();

    const emptyClient: ElectrumClient = {
      getUTXOs(): Promise<ElectrumUtxo[]> {
        return Promise.resolve([]);
      },
      getRawTransaction(): Promise<string> {
        return Promise.resolve("");
      },
    };

    // Extension finds no sidecar, returns unmodified UTXO
    const modifiedUtxo = await invokeExtensions(
      utxo,
      identity,
      emptyClient,
      "bchtest",
    );

    // Parse should fall back to type "" (no data)
    const result = parseNft(modifiedUtxo, parseInfo);

    expect(result.success).toBe(true);
    expect(result.nftType).toBe("");
    expect(result.nftTypeName).toBe("Loan Key (no loan data)");
    expect(result.namedFields).toHaveLength(0);
  });
});
