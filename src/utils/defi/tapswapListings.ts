// Assets the wallet has listed for sale on TapSwap (tapswap.cash).
//
// A listing locks the asset in a per-listing sale contract, announced by an "MPSW" OP_RETURN at
// output 1 of the listing transaction, with the contract UTXO at output 0. A listing is active
// while its contract UTXO is unspent; buying or cancelling spends it.
//
// The announcement names the maker only at a variable offset, out of reach of Chaingraph's
// prefix search, so listings cannot be looked up by maker directly. Instead, since the maker
// funds the listing from their own address, the wallet's listings are found by walking the
// transactions that spent the wallet's outputs, in one Chaingraph query (which does share the
// wallet's address list with the configured Chaingraph server).
//
// The announcement format was verified against the deployed contract, revealed by settled
// trades. The closest thing to a spec is the TapSwap developer's parsing example:
// https://github.com/mainnet-pat/tapswap-subsquid

import {
  hexToBin,
  binToHex,
  vmNumberToBigInt,
  decodeAuthenticationInstructions,
  authenticationInstructionsAreMalformed,
} from "@bitauth/libauth";
import { byteaToHex, type ChaingraphSpentOutput } from "src/queryChainGraph";

// OP_RETURN, "MPSW", version 4, then the first 4 bytes of the sha256 of the contract's constant
// bytecode, pinning the exact contract version the rest of the announcement describes
const LISTING_ANNOUNCEMENT_PREFIX = "6a044d5053570104043d400caf";

// TapSwap's fee address, named in every announcement and enforced by the contract
const TAPSWAP_PLATFORM_PKH = "e4da17ddbe40533c2a8638fdedf2c0997d46e953";

// The announcement is ten pushes: marker, version, contract hash, platform pkh, asking price,
// three "want" fields (empty when the listing asks plain BCH), maker pkh, and the platform fee
const ANNOUNCEMENT_CHUNKS = { count: 10, platformPkh: 3, price: 4, wantFields: [5, 6, 7], makerPkh: 8, fee: 9 };

export interface TapswapListing {
  /** The listing transaction; the contract UTXO holding the asset is always its output 0 */
  txid: string;
  category: string;
  /** NFT commitment, undefined when the listing holds only fungible tokens */
  commitment: string | undefined;
  tokenAmount: bigint;
  /** Asking price of the listing, in satoshis */
  priceSats: bigint;
}

// Parse a listing announcement into its offer terms, only when it is well-formed and asks
// plain BCH
export function parseListingAnnouncement(opReturnHex: string) {
  if (!opReturnHex.startsWith(LISTING_ANNOUNCEMENT_PREFIX)) return undefined;
  const instructions = decodeAuthenticationInstructions(hexToBin(opReturnHex));
  if (authenticationInstructionsAreMalformed(instructions)) return undefined;

  // the first instruction is the OP_RETURN itself, the announcement fields are the pushes after it
  const chunks: Uint8Array[] = [];
  for (const instruction of instructions.slice(1)) {
    if (!('data' in instruction)) return undefined;
    chunks.push(instruction.data);
  }
  if (chunks.length !== ANNOUNCEMENT_CHUNKS.count) return undefined;
  if (binToHex(chunks[ANNOUNCEMENT_CHUNKS.platformPkh]!) !== TAPSWAP_PLATFORM_PKH) return undefined;
  // a listing asking tokens instead of plain BCH has no BCH asking price to show; the format
  // supports token asks but TapSwap itself currently only creates BCH asks
  if (ANNOUNCEMENT_CHUNKS.wantFields.some(index => chunks[index]!.length > 0)) return undefined;
  const priceSats = vmNumberToBigInt(chunks[ANNOUNCEMENT_CHUNKS.price]!);
  if (typeof priceSats === "string") return undefined;
  const feeSats = vmNumberToBigInt(chunks[ANNOUNCEMENT_CHUNKS.fee]!);
  if (typeof feeSats === "string") return undefined;
  return {
    makerPkh: binToHex(chunks[ANNOUNCEMENT_CHUNKS.makerPkh]!),
    priceSats,
    feeSats,
  };
}

// Pick the wallet's active listings out of the transactions that spent its outputs
export function listingsFromSpentOutputs(spentOutputs: ChaingraphSpentOutput[], ownerPkhs: string[]) {
  // a listing transaction spending several wallet outputs appears once per output
  const seenTxids: string[] = [];
  const listings: TapswapListing[] = [];
  for (const spentOutput of spentOutputs) {
    for (const spend of spentOutput.spent_by) {
      const txid = byteaToHex(spend.transaction.hash);
      if (seenTxids.includes(txid)) continue;
      seenTxids.push(txid);

      const announcement = spend.transaction.outputs.find((output) => output.output_index === "1");
      const contractOutput = spend.transaction.outputs.find((output) => output.output_index === "0");
      if (!announcement || !contractOutput) continue;
      const offer = parseListingAnnouncement(byteaToHex(announcement.locking_bytecode));
      if (!offer) continue;
      if (!ownerPkhs.includes(offer.makerPkh)) continue;
      if (contractOutput.spent_by.length > 0) continue;
      if (contractOutput.token_category === null) continue;

      const rawCommitment = contractOutput.nonfungible_token_commitment;
      listings.push({
        txid,
        category: byteaToHex(contractOutput.token_category),
        commitment: rawCommitment === null ? undefined : byteaToHex(rawCommitment),
        tokenAmount: BigInt(contractOutput.fungible_token_amount ?? 0),
        priceSats: offer.priceSats,
      });
    }
  }
  return listings;
}

