import { parseListingAnnouncement, listingsFromSpentOutputs } from "../src/utils/defi/tapswapListings";
import type { ChaingraphSpentOutput } from "../src/queryChainGraph";

// Real mainnet listing announcements: an NFT listed for 0.04 BCH and a fungible token
// listing, with different makers
const nftAnnouncement = "6a044d5053570104043d400caf14e4da17ddbe40533c2a8638fdedf2c0997d46e9530300093d000000148ee26d6c9f58369f94864dc3630cdeb17fae2f2d03c0d401";
const nftMakerPkh = "8ee26d6c9f58369f94864dc3630cdeb17fae2f2d";
const ftAnnouncement = "6a044d5053570104043d400caf14e4da17ddbe40533c2a8638fdedf2c0997d46e9530105000000142458b6396f0f866f4b60af2b7655dc9fc490e0c403a08601";
const ftMakerPkh = "2458b6396f0f866f4b60af2b7655dc9fc490e0c4";

describe('parseListingAnnouncement', () => {
  it('should parse a listing made by one of the given pkhs', () => {
    expect(parseListingAnnouncement(nftAnnouncement, [nftMakerPkh])).toEqual({ priceSats: 4_000_000n });
    expect(parseListingAnnouncement(ftAnnouncement, [ftMakerPkh])).toEqual({ priceSats: 5n });
  })
  it('should reject a listing made by someone else', () => {
    expect(parseListingAnnouncement(nftAnnouncement, [ftMakerPkh])).toBeUndefined();
    expect(parseListingAnnouncement(nftAnnouncement, [])).toBeUndefined();
  })
  it('should reject other OP_RETURN outputs', () => {
    expect(parseListingAnnouncement("6a0450555348", [nftMakerPkh])).toBeUndefined();
  })
  it('should reject an announcement naming another platform pkh', () => {
    const otherPlatform = nftAnnouncement.replace("e4da17ddbe40533c2a8638fdedf2c0997d46e953", "0000000000000000000000000000000000000000");
    expect(parseListingAnnouncement(otherPlatform, [nftMakerPkh])).toBeUndefined();
  })
})

// A spent wallet output whose spending transaction is the Cash-Ninjas listing above
function spentOutputFixture(contractSpentBy: { input_index: string }[]): ChaingraphSpentOutput {
  return {
    spent_by: [{
      transaction: {
        hash: "\\xc02261eb029a2b960cd611df6544766668a9b01df0da7aaec9d81b4049f103bc",
        outputs: [
          {
            output_index: "0",
            locking_bytecode: "\\xa914a261e5872f511029097c048243c5cf7c102f379087",
            token_category: "\\x77a95410a07c2392c340384aef323aea902ebfa698a35815c4ef100062c6d8ac",
            nonfungible_token_commitment: "\\xd300",
            fungible_token_amount: "0",
            spent_by: contractSpentBy
          },
          {
            output_index: "1",
            locking_bytecode: "\\x" + nftAnnouncement,
            token_category: null,
            nonfungible_token_commitment: null,
            fungible_token_amount: null,
            spent_by: []
          }
        ]
      }
    }]
  };
}

describe('listingsFromSpentOutputs', () => {
  it('should extract an active listing', () => {
    expect(listingsFromSpentOutputs([spentOutputFixture([])], [nftMakerPkh])).toEqual([{
      txid: "c02261eb029a2b960cd611df6544766668a9b01df0da7aaec9d81b4049f103bc",
      category: "77a95410a07c2392c340384aef323aea902ebfa698a35815c4ef100062c6d8ac",
      commitment: "d300",
      tokenAmount: 0n,
      priceSats: 4_000_000n
    }]);
  })
  it('should skip a listing whose contract utxo is spent', () => {
    expect(listingsFromSpentOutputs([spentOutputFixture([{ input_index: "0" }])], [nftMakerPkh])).toEqual([]);
  })
  it('should report a listing spending several wallet outputs once', () => {
    const listings = listingsFromSpentOutputs([spentOutputFixture([]), spentOutputFixture([])], [nftMakerPkh]);
    expect(listings.length).toBe(1);
  })
  it('should skip transactions that are no listing at all', () => {
    const ordinarySpend: ChaingraphSpentOutput = {
      spent_by: [{
        transaction: {
          hash: "\\x" + "ab".repeat(32),
          outputs: [{
            output_index: "0",
            locking_bytecode: "\\x76a914" + nftMakerPkh + "88ac",
            token_category: null,
            nonfungible_token_commitment: null,
            fungible_token_amount: null,
            spent_by: []
          }]
        }
      }]
    };
    expect(listingsFromSpentOutputs([ordinarySpend], [nftMakerPkh])).toEqual([]);
  })
})
