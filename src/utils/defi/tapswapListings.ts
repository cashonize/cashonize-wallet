// Assets the wallet has listed for sale on TapSwap (tapswap.cash).
//
// A listing locks the asset in a per-listing sale contract, announced by an "MPSW" OP_RETURN at
// output 1 of the listing transaction, with the contract UTXO at output 0. A listing is active
// while its contract UTXO is unspent; buying or cancelling spends it.
//
// The announcement names the maker only at a variable offset, so listings cannot be looked up
// by maker on any indexer. Instead, since the maker funds the listing from their own address,
// the listing transaction is in the wallet's own history, and the announcements are read off
// that; whether a contract UTXO is still unspent is one electrum lookup per listing.
//
// The announcement format was verified against the deployed contract, revealed by settled
// trades. The closest thing to a spec is the TapSwap developer's parsing example:
// https://github.com/mainnet-pat/tapswap-subsquid

import {
  binToHex,
  vmNumberToBigInt,
} from "@bitauth/libauth";
import type { ElectrumNetworkProvider, TransactionHistoryItem } from "mainnet-js";
import { opReturnChunks, opReturnHex } from "src/utils/history/txDirection";

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
  /** The sale contract's address, where the asset sits while the listing is active */
  contractAddress: string;
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
  const chunks = opReturnChunks(opReturnHex);
  if (chunks?.length !== ANNOUNCEMENT_CHUNKS.count) return undefined;
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

// Pick the wallet's listings out of its transaction history, whether still active or not
export function listingsFromHistory(history: TransactionHistoryItem[], ownerPkhs: string[]) {
  const candidates: TapswapListing[] = [];
  for (const transaction of history) {
    const announcementHex = opReturnHex(transaction.outputs[1]);
    const contractOutput = transaction.outputs[0];
    if (!announcementHex || !contractOutput?.token) continue;
    const offer = parseListingAnnouncement(announcementHex);
    if (!offer) continue;
    if (!ownerPkhs.includes(offer.makerPkh)) continue;

    candidates.push({
      txid: transaction.hash,
      contractAddress: contractOutput.address,
      category: contractOutput.token.category,
      commitment: contractOutput.token.nft?.commitment,
      tokenAmount: BigInt(contractOutput.token.amount),
      priceSats: offer.priceSats,
    });
  }
  return candidates;
}

// Keep the listings whose contract UTXO is still unspent, which the history cannot say
export async function fetchActiveListings(provider: ElectrumNetworkProvider, candidates: TapswapListing[]) {
  const contractUtxos = await Promise.all(candidates.map(candidate => provider.getUtxos(candidate.contractAddress)));
  return candidates.filter((listing, index) =>
    contractUtxos[index]!.some(utxo => utxo.txid === listing.txid && utxo.vout === 0)
  );
}
