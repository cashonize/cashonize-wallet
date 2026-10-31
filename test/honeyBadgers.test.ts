import { vi } from "vitest";
import type { Utxo } from "@cashonize/bch-wallet-lib";
import { honeyBadgersTypeKey, parseHoneyBadgersNft } from "../src/parsing/honeyBadgers";
import { BADGERCOIN_CATEGORY } from "../src/utils/defi/badgersStake";
import { fetchTokenMetadata } from "../src/stores/storeUtils";
import { cachedFetch } from "../src/utils/cacheUtils";

vi.mock("../src/utils/cacheUtils", () => ({ cachedFetch: vi.fn() }));

// commitments of NFTs held on mainnet
const badger20 = "140000070807030a0300" + "00".repeat(30);
const honeyFor3 = "000003";
const honeyFor10 = "00000a";

describe("honeyBadgersTypeKey", () => {
  it("is the id the registry keys a type by: empty for Honey, the script number for a Badger", () => {
    expect(honeyBadgersTypeKey(BADGERCOIN_CATEGORY, honeyFor3)).toBe("");
    expect(honeyBadgersTypeKey(BADGERCOIN_CATEGORY, "0000f401")).toBe("");
    expect(honeyBadgersTypeKey(BADGERCOIN_CATEGORY, badger20)).toBe("14");
  });

  it("is undefined for another category, or a commitment too short to hold an id", () => {
    expect(honeyBadgersTypeKey("00".repeat(32), badger20)).toBeUndefined();
    expect(honeyBadgersTypeKey(BADGERCOIN_CATEGORY, "00")).toBeUndefined();
  });
});

describe("parseHoneyBadgersNft", () => {
  it("reads the BadgerCoins Honey was earned for, leaving the name to the registry", () => {
    for (const [commitment, earned] of [[honeyFor3, "3 BADGER"], ["00001e", "30 BADGER"], ["0000f401", "500 BADGER"]]) {
      const result = parseHoneyBadgersNft(commitment!);
      expect(result.success).toBe(true);
      expect(result.nftTypeName).toBeUndefined();
      expect(result.namedFields?.map(field => field.parsedValue?.formatted)).toEqual([earned]);
    }
  });

  // Badger #20 as badgers.cash shows it
  it("reads a Badger's id and stats", () => {
    const result = parseHoneyBadgersNft(badger20);
    expect(result.success).toBe(true);
    expect(result.nftTypeName).toBeUndefined();
    expect(result.namedFields?.map(field => `${field.name} ${field.parsedValue?.formatted}`)).toEqual([
      "Id 20", "Level 0", "Strength 7", "Stamina 8", "Agility 7", "Wisdom 3", "Attack 10", "Defence 3",
    ]);
  });
});

describe("fetchTokenMetadata for HoneyBadgers", () => {
  const indexer = "https://indexer.test/api";
  const typeMetadata: Record<string, { name: string, description: string }> = {
    "14": { name: "Badger #20", description: "BitcoinCash HoneyBadger" },
    empty: { name: "Honey", description: "BitcoinCash HoneyBadger Honey" },
  };
  const nft = (vout: number, commitment: string): Utxo => ({
    txid: "aa".repeat(32), vout, satoshis: 1000n, address: "bitcoincash:qtest",
    token: { category: BADGERCOIN_CATEGORY, amount: 0n, nft: { commitment, capability: "none" } },
  });

  it("looks NFTs up by their type and keeps the answer under each commitment", async () => {
    vi.mocked(cachedFetch).mockImplementation((url: string) => {
      const key = url.split("/").at(-2)!;
      const body = {
        name: "HoneyBadgers", description: "BitcoinCash HoneyBadgers", uris: {},
        token: { category: BADGERCOIN_CATEGORY, symbol: "BADGER", decimals: 0 },
        is_nft: true, nft_type: "sequential", type_metadata: typeMetadata[key],
      };
      const response = new Response(JSON.stringify(body), { status: 200 });
      Object.defineProperty(response, "url", { value: url });
      return Promise.resolve(response);
    });
    const tokenList = [{ category: BADGERCOIN_CATEGORY, nfts: [nft(0, badger20), nft(1, honeyFor3), nft(2, honeyFor10)] }];

    const registries = await fetchTokenMetadata(tokenList, true, indexer, {});

    expect(vi.mocked(cachedFetch).mock.calls.map(([url]) => url)).toEqual([
      `${indexer}/tokens/${BADGERCOIN_CATEGORY}/14/`,
      `${indexer}/tokens/${BADGERCOIN_CATEGORY}/empty/`,
    ]);
    expect(registries[BADGERCOIN_CATEGORY]?.nfts).toEqual({
      [badger20]: typeMetadata["14"],
      [honeyFor3]: typeMetadata.empty,
      [honeyFor10]: typeMetadata.empty,
    });
  });
});
