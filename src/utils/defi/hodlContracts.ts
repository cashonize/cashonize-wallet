// BCH the wallet has locked in hodl contracts.
//
// A hodl contract locks BCH until an absolute locktime with OP_CHECKLOCKTIMEVERIFY, after which
// only the owner can spend it. The funding transaction announces it with a "hodl" OP_RETURN at
// output 0 carrying the contract address and the locktime, but not the owner: ownership is
// established by rebuilding the contract from the wallet's own pkhs and the announced locktime
// and matching the announced address. The owner funds the contract from their own address, so
// the funding transaction is in the wallet's own history, and the announcements are read off
// that the way the TapSwap lookup reads its own (those sit at output 1, these at 0).
// Contract: https://github.com/mainnet-pat/hodl_ec_plugin

import {
  hexToBin,
  binToHex,
  binToUtf8,
  hash160,
  bigIntToVmNumber,
  decodeBase58Address,
  decodeCashAddress,
  encodeCashAddress,
} from "@bitauth/libauth";
import type { ElectrumNetworkProvider, TransactionHistoryItem } from "mainnet-js";
import { opReturnChunks, opReturnHex } from "src/utils/history/txDirection";

// OP_RETURN + the "hodl" Lokad id
const HODL_ANNOUNCEMENT_PREFIX = "6a04686f646c";

// The announcement is three pushes: the Lokad id, the contract address (with a version suffix
// from some creating software), and the locktime as a decimal string
const ANNOUNCEMENT_CHUNK_COUNT = 3;
const ADDRESS_CHUNK = 1;
const LOCKTIME_CHUNK = 2;

// nLockTime values below this are block heights, above it unix timestamps
export const LOCKTIME_TIMESTAMP_THRESHOLD = 500_000_000;

// The contract around its locktime and owner pkh parameters:
// OP_CHECKLOCKTIMEVERIFY OP_DROP OP_DUP OP_HASH160 OP_PUSHBYTES_20
const HODL_SCRIPT_MIDDLE = "b17576a914";
// OP_EQUALVERIFY OP_CHECKSIG
const HODL_SCRIPT_SUFFIX = "88ac";

export interface HodlContract {
  /** hash160 of the contract's redeem script, its P2SH20 script hash */
  scriptHash: string;
  /** Block height below 500,000,000, unix timestamp above */
  locktime: number;
  satoshis: bigint;
}

// The locktime is pushed as a minimal VM number: the same bytes creating software writes,
// for every locktime OP_CHECKLOCKTIMEVERIFY can accept
function hodlRedeemScript(locktime: number, ownerPkh: string) {
  const locktimeBytes = bigIntToVmNumber(BigInt(locktime));
  const locktimePush = Uint8Array.from([locktimeBytes.length, ...locktimeBytes]);
  return hexToBin(binToHex(locktimePush) + HODL_SCRIPT_MIDDLE + ownerPkh + HODL_SCRIPT_SUFFIX);
}

// The announced address encoding follows the creating software: a legacy base58 address, or a
// cashaddr with or without prefix
function decodeAnnouncedAddress(address: string) {
  if (address.startsWith("3")) {
    const decoded = decodeBase58Address(address);
    // 5 is the P2SH version byte of legacy mainnet addresses
    if (typeof decoded === "string" || decoded.version !== 5) return undefined;
    return binToHex(decoded.payload);
  }
  const cashaddr = address.includes(":") ? address : "bitcoincash:" + address;
  const decoded = decodeCashAddress(cashaddr);
  if (typeof decoded === "string" || decoded.type !== "p2sh" || decoded.payload.length !== 20) return undefined;
  return binToHex(decoded.payload);
}

// Parse a hodl announcement into the announced contract script hash and locktime, when it is
// well-formed
export function parseHodlAnnouncement(announcementHex: string) {
  if (!announcementHex.startsWith(HODL_ANNOUNCEMENT_PREFIX)) return undefined;
  const chunks = opReturnChunks(announcementHex);
  if (chunks?.length !== ANNOUNCEMENT_CHUNK_COUNT) return undefined;

  // the address chunk is "<address>" or "<address> <version>"
  const address = binToUtf8(chunks[ADDRESS_CHUNK]!).split(" ")[0]!;
  const scriptHash = decodeAnnouncedAddress(address);
  if (!scriptHash) return undefined;

  const locktimeString = binToUtf8(chunks[LOCKTIME_CHUNK]!);
  if (!/^\d+$/.test(locktimeString)) return undefined;
  const locktime = parseInt(locktimeString);
  // the valid nLockTime range; 0 would be an unlocked contract no software creates
  if (locktime <= 0 || locktime > 0xffffffff) return undefined;
  return { scriptHash, locktime };
}

// Pick the wallet's hodl contracts out of its transaction history
export function hodlContractsFromHistory(history: TransactionHistoryItem[], ownerPkhs: string[]) {
  const candidates: { scriptHash: string, locktime: number }[] = [];
  for (const transaction of history) {
    const announcementHex = opReturnHex(transaction.outputs[0]);
    if (!announcementHex) continue;
    const announcement = parseHodlAnnouncement(announcementHex);
    if (!announcement) continue;
    // the same contract can be announced by more than one transaction
    if (candidates.some((candidate) => candidate.scriptHash === announcement.scriptHash)) continue;
    // The announcement does not name the owner, and funding a contract does not imply owning
    // it: the wallet owns it only when one of its own pkhs rebuilds the announced script hash.
    const ownedByWallet = ownerPkhs.some(
      (pkh) => binToHex(hash160(hodlRedeemScript(announcement.locktime, pkh))) === announcement.scriptHash
    );
    if (!ownedByWallet) continue;
    candidates.push(announcement);
  }
  return candidates;
}

// Look up what the given hodl contracts hold. A contract can hold several UTXOs (anyone can add
// funds to the address); a drained one holds none and is dropped. Mainnet only, like the
// announcements.
export async function fetchHodlContractStates(
  provider: ElectrumNetworkProvider,
  candidates: { scriptHash: string, locktime: number }[]
) {
  const contracts: HodlContract[] = [];
  for (const candidate of candidates) {
    const address = encodeCashAddress({
      prefix: "bitcoincash", type: "p2sh", payload: hexToBin(candidate.scriptHash), throwErrors: true
    }).address;
    const utxos = await provider.getUtxos(address);
    const satoshis = utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0n);
    if (satoshis === 0n) continue;
    contracts.push({ ...candidate, satoshis });
  }
  return contracts;
}
