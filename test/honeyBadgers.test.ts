import type { Utxo } from "@cashonize/bch-wallet-lib";
import { parseHoneyBadgersNft } from "../src/parsing/honeyBadgers";
import { BADGERCOIN_CATEGORY } from "../src/utils/defi/badgersStake";

const nft = (commitment: string): Utxo => ({
  txid: "aa".repeat(32), vout: 1, satoshis: 1000n, address: "bitcoincash:qtest",
  token: { category: BADGERCOIN_CATEGORY, amount: 0n, nft: { commitment, capability: "none" } },
});

// commitments of NFTs held on mainnet
describe("parseHoneyBadgersNft", () => {
  it("reads Honey and the BadgerCoins its stake earned", () => {
    for (const [commitment, earned] of [["000003", "3 BADGER"], ["00001e", "30 BADGER"], ["0000f401", "500 BADGER"]]) {
      const result = parseHoneyBadgersNft(nft(commitment!));
      expect(result.success).toBe(true);
      expect(result.nftTypeName).toBe("Honey");
      expect(result.namedFields?.map(field => field.parsedValue?.formatted)).toEqual([earned]);
    }
  });

  it("reads a Badger's id from its 40-byte commitment", () => {
    const result = parseHoneyBadgersNft(nft("140000070807030a0300" + "00".repeat(30)));
    expect(result.success).toBe(true);
    expect(result.nftTypeName).toBe("HoneyBadger");
    expect(result.namedFields?.map(field => field.parsedValue?.formatted)).toEqual(["20"]);
  });

  it("fails on a commitment too short to hold an id", () => {
    expect(parseHoneyBadgersNft(nft("00")).success).toBe(false);
  });
});
