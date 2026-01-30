import { describe, it, expect, vi } from "vitest";
import { createElectrumAdapter } from "src/parsing/electrumAdapter";
import { invokeExtensions } from "src/parsing/extensions/index";
import type { Output } from "@bitauth/libauth";
import { hexToBin } from "@bitauth/libauth";
import type { IdentitySnapshot } from "src/parsing/bcmr-v2.schema";

describe("createElectrumAdapter", () => {
  it("converts UtxoI format to ElectrumUtxo format", async () => {
    const mockProvider = {
      getUtxos: vi.fn().mockResolvedValue([
        {
          txid: "abc123",
          vout: 0,
          satoshis: 1000,
          height: 800000,
          token: {
            tokenId: "def456",
            amount: 100n,
            capability: "none" as const,
            commitment: "aabb",
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
          satoshis: 5000,
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
