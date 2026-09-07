import { describe, expect, it, vi } from "vitest";
import { parseListingAnnouncement, listingsFromHistory, fetchActiveListings } from "../src/utils/defi/tapswapListings";
import { historyItem, opReturnOutput, p2pkhOutput, tokenOutput } from "./mocks/history.mocks";

// Real mainnet listing announcements: an NFT listed for 0.04 BCH and a fungible token
// listing, with different makers
const nftAnnouncement = "6a044d5053570104043d400caf14e4da17ddbe40533c2a8638fdedf2c0997d46e9530300093d000000148ee26d6c9f58369f94864dc3630cdeb17fae2f2d03c0d401";
const nftMakerPkh = "8ee26d6c9f58369f94864dc3630cdeb17fae2f2d";
const ftAnnouncement = "6a044d5053570104043d400caf14e4da17ddbe40533c2a8638fdedf2c0997d46e9530105000000142458b6396f0f866f4b60af2b7655dc9fc490e0c403a08601";
const ftMakerPkh = "2458b6396f0f866f4b60af2b7655dc9fc490e0c4";

describe('parseListingAnnouncement', () => {
  it('should parse the offer terms of a listing announcement', () => {
    expect(parseListingAnnouncement(nftAnnouncement)).toEqual({
      makerPkh: nftMakerPkh, priceSats: 4_000_000n, feeSats: 120_000n
    });
    expect(parseListingAnnouncement(ftAnnouncement)).toEqual({
      makerPkh: ftMakerPkh, priceSats: 5n, feeSats: 100_000n
    });
  })
  it('should reject other OP_RETURN outputs', () => {
    expect(parseListingAnnouncement("6a0450555348")).toBeUndefined();
  })
  it('should reject an announcement naming another platform pkh', () => {
    const otherPlatform = nftAnnouncement.replace("e4da17ddbe40533c2a8638fdedf2c0997d46e953", "0000000000000000000000000000000000000000");
    expect(parseListingAnnouncement(otherPlatform)).toBeUndefined();
  })
  it('should reject a listing asking tokens instead of plain BCH', () => {
    // the real announcement with its three empty want pushes replaced by a want category push
    const tokenAsk = nftAnnouncement.replace("0300093d000000", "0300093d20" + "aa".repeat(32) + "0000");
    expect(parseListingAnnouncement(tokenAsk)).toBeUndefined();
  })
})

// The Cash-Ninjas listing above as the wallet's history carries it: the sale contract at
// output 0 holding the NFT, the announcement at output 1
const listingTxid = "c02261eb029a2b960cd611df6544766668a9b01df0da7aaec9d81b4049f103bc";
const contractAddress = "bitcoincash:pz3xrev8942yg2gf0szgys79e7lqs9um7qlqq4xda2";
const listedCategory = "77a95410a07c2392c340384aef323aea902ebfa698a35815c4ef100062c6d8ac";
const listingItem = historyItem(listingTxid, [
  tokenOutput(listedCategory, { commitment: "d300" }, contractAddress),
  opReturnOutput(nftAnnouncement),
]);
const listing = {
  txid: listingTxid,
  contractAddress,
  category: listedCategory,
  commitment: "d300",
  tokenAmount: 0n,
  priceSats: 4_000_000n,
};

describe('listingsFromHistory', () => {
  it("should read a listing off the wallet's history", () => {
    expect(listingsFromHistory([listingItem], [nftMakerPkh])).toEqual([listing]);
  })
  it('should skip a listing made by someone else', () => {
    expect(listingsFromHistory([listingItem], [ftMakerPkh])).toEqual([]);
    expect(listingsFromHistory([listingItem], [])).toEqual([]);
  })
  it('should skip transactions that are no listing at all', () => {
    const ordinarySpend = historyItem("ab".repeat(32), [p2pkhOutput(), p2pkhOutput()]);
    const tokenSend = historyItem("cd".repeat(32), [tokenOutput(listedCategory, { commitment: "d300" }), p2pkhOutput()]);
    expect(listingsFromHistory([ordinarySpend, tokenSend], [nftMakerPkh])).toEqual([]);
  })
})

// The listing is active while its contract UTXO is unspent, which is asked of electrum per
// listing: the history holds the listing, not what became of it
describe('fetchActiveListings', () => {
  const contractUtxo = { txid: listingTxid, vout: 0, satoshis: 1000n, address: contractAddress };
  it('should keep a listing whose contract utxo is unspent', async () => {
    const provider = { getUtxos: vi.fn().mockResolvedValue([contractUtxo]) };
    expect(await fetchActiveListings(provider as never, [listing])).toEqual([listing]);
    expect(provider.getUtxos).toHaveBeenCalledWith(contractAddress);
  })
  it('should drop a listing whose contract utxo is spent', async () => {
    const provider = { getUtxos: vi.fn().mockResolvedValue([]) };
    expect(await fetchActiveListings(provider as never, [listing])).toEqual([]);
  })
  it('should not mistake another coin at the contract address for the listing', async () => {
    const provider = { getUtxos: vi.fn().mockResolvedValue([{ ...contractUtxo, vout: 1 }]) };
    expect(await fetchActiveListings(provider as never, [listing])).toEqual([]);
  })
})
