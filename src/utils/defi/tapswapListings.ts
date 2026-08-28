// Assets the wallet has listed for sale on TapSwap (tapswap.cash).
//
// A listing locks the asset in a per-listing sale contract, announced by an "MPSW" OP_RETURN at
// output 1 of the listing transaction, with the contract UTXO at output 0. The maker funds the
// listing from their own address, so the wallet's listings are found by walking the transactions
// that spent the wallet's outputs, in one Chaingraph query (which does share the wallet's
// address list with the configured Chaingraph server). A listing is active while its contract
// UTXO is unspent; buying and cancelling both spend it.
//
// The contract is not open source; the announcement format was verified against the deployed
// contract, revealed by settled trades. Reference: https://github.com/mainnet-pat/tapswap-subsquid

import {
  hexToBin,
  binToHex,
  binToNumberUint16LE,
  vmNumberToBigInt,
  encodeLockingBytecodeP2pkh,
  // the un-yeared OpcodesBch alias is only exported as a value, not as a type
  OpcodesBch2023 as OpcodesBch,
} from "@bitauth/libauth";
import { querySpentOutputs, byteaToHex, type ChaingraphSpentOutput } from "src/queryChainGraph";

// OP_RETURN, "MPSW", version 4, then the first 4 bytes of the sha256 of the contract's constant
// bytecode, pinning the exact contract version the rest of the announcement describes
const LISTING_ANNOUNCEMENT_PREFIX = "6a044d5053570104043d400caf";

// TapSwap's fee address, named in every announcement and enforced by the contract
const TAPSWAP_PLATFORM_PKH = "e4da17ddbe40533c2a8638fdedf2c0997d46e953";

// The announcement is ten pushes: marker, version, contract hash, platform pkh, asking price,
// three "want" fields (empty when the listing asks plain BCH), maker pkh, and the platform fee
const ANNOUNCEMENT_CHUNKS = { count: 10, platformPkh: 3, price: 4, makerPkh: 8 };

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

// Split an OP_RETURN into its pushed chunks. Direct pushes and OP_PUSHDATA1/2 cover everything
// OP_RETURN outputs allow; OP_PUSHDATA4 is not standard in them.
function parseOpReturnChunks(opReturn: Uint8Array) {
  const chunks: Uint8Array[] = [];
  let position = 1;
  while (opReturn[position] !== undefined) {
    let length;
    const opcode = opReturn[position] as OpcodesBch;
    if (opcode === OpcodesBch.OP_PUSHDATA_1) {
      length = opReturn[position + 1] ?? 0;
      position += 2;
    } else if (opcode === OpcodesBch.OP_PUSHDATA_2) {
      length = binToNumberUint16LE(opReturn.slice(position + 1, position + 3));
      position += 3;
    } else {
      // a direct push, the opcode itself is the length
      length = opcode;
      position += 1;
    }
    chunks.push(opReturn.slice(position, position + length));
    position += length;
  }
  return chunks;
}

// Parse a listing announcement, returning the asking price only when the announcement is
// well-formed and names one of the given pkhs as the maker
export function parseListingAnnouncement(opReturnHex: string, ownerPkhs: string[]) {
  if (!opReturnHex.startsWith(LISTING_ANNOUNCEMENT_PREFIX)) return undefined;
  const chunks = parseOpReturnChunks(hexToBin(opReturnHex));
  if (chunks.length !== ANNOUNCEMENT_CHUNKS.count) return undefined;
  if (binToHex(chunks[ANNOUNCEMENT_CHUNKS.platformPkh]!) !== TAPSWAP_PLATFORM_PKH) return undefined;
  if (!ownerPkhs.includes(binToHex(chunks[ANNOUNCEMENT_CHUNKS.makerPkh]!))) return undefined;
  const priceSats = vmNumberToBigInt(chunks[ANNOUNCEMENT_CHUNKS.price]!);
  if (typeof priceSats === "string") return undefined;
  return { priceSats };
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
      const offer = parseListingAnnouncement(byteaToHex(announcement.locking_bytecode), ownerPkhs);
      if (!offer) continue;
      if (contractOutput.spent_by.length > 0) continue;
      if (contractOutput.token_category == null) continue;

      const rawCommitment = contractOutput.nonfungible_token_commitment;
      listings.push({
        txid,
        category: byteaToHex(contractOutput.token_category),
        commitment: rawCommitment == null ? undefined : byteaToHex(rawCommitment),
        tokenAmount: BigInt(contractOutput.fungible_token_amount ?? 0),
        priceSats: offer.priceSats,
      });
    }
  }
  return listings;
}

// Look up the active TapSwap listings made by the given public key hashes
export async function fetchTapswapListings(ownerPkhs: string[], chaingraphUrl: string) {
  if (!ownerPkhs.length) return [];
  const lockingBytecodes = ownerPkhs.map((pkh) => binToHex(encodeLockingBytecodeP2pkh(hexToBin(pkh))));
  const spentOutputs = await querySpentOutputs(lockingBytecodes, chaingraphUrl);
  return listingsFromSpentOutputs(spentOutputs, ownerPkhs);
}
