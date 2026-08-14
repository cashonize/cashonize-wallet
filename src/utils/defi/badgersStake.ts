// BCH locked in the Badgers.cash staking contract.
//
// Locking BCH there mints BadgerCoins, and the BCH comes back to the address that locked it once
// the lock has aged past its length. Every lock of every user sits at the same contract address,
// with the owner written into the lock's own NFT commitment, so finding a wallet's locks is one
// lookup on that address followed by matching the commitments against the wallet's addresses.
//
// The wallet holds nothing that represents a lock, which is why locked BCH is invisible to it
// without this. Contract: https://github.com/SayoshiNakamario/BadgersStake

import { binToHex, hexToBin, binToNumberUint16LE } from "@bitauth/libauth";
import type { ElectrumNetworkProvider, Utxo } from "mainnet-js";

// The single contract holding every lock, on mainnet only. Its token-aware form, since a lock
// carries an NFT next to the BCH.
const BADGERS_CONTRACT_ADDRESS = "bitcoincash:rvgcl3xk6nwqlngkk09e7g67x5vxs57jv6v2q4qm4ct5yv4d3ppfgdzhpuxn8";
export const BADGERCOIN_CATEGORY = "242f6ecedb404c743477e35b09733a56cacae34f3109d5cee1cbc1d5630affd7";

// A lock commitment is the payout public key hash (20 bytes), 18 zero bytes, and the length of
// the lock in blocks (2 bytes, little-endian)
const COMMITMENT_BYTES = 40;
const PAYOUT_PKH_BYTES = 20;
const STAKE_LENGTH_OFFSET = 38;

export interface BadgerLock {
  txid: string;
  vout: number;
  satoshis: bigint;
  /** Block the lock was confirmed in, undefined while it is still in the mempool */
  confirmedAtHeight: number | undefined;
  /** How long the lock runs for, counted from the block it was confirmed in */
  stakeBlocks: number;
}

function parseLockCommitment(commitment: string | undefined) {
  if (!commitment || commitment.length !== COMMITMENT_BYTES * 2) return undefined;
  if (!/^[0-9a-fA-F]+$/.test(commitment)) return undefined;
  const commitmentBytes = hexToBin(commitment);
  return {
    payoutPkh: binToHex(commitmentBytes.slice(0, PAYOUT_PKH_BYTES)),
    stakeBlocks: binToNumberUint16LE(commitmentBytes.slice(STAKE_LENGTH_OFFSET))
  };
}

// The contract's timelock is relative, checked with tx.age, so a lock opens its own length of
// blocks after the block it was confirmed in rather than at a height written into it.
function lockFromUtxo(utxo: Utxo, ownerPkhs: string[]): BadgerLock | undefined {
  if (utxo.token?.category !== BADGERCOIN_CATEGORY) return undefined;
  // the contract's own administrative UTXO is a minting NFT, a lock is always mutable
  if (utxo.token.nft?.capability !== "mutable") return undefined;
  const lock = parseLockCommitment(utxo.token.nft.commitment);
  if (!lock || !ownerPkhs.includes(lock.payoutPkh)) return undefined;
  return {
    txid: utxo.txid,
    vout: utxo.vout,
    satoshis: utxo.satoshis,
    // electrum reports a utxo still in the mempool at height 0
    confirmedAtHeight: utxo.height ? utxo.height : undefined,
    stakeBlocks: lock.stakeBlocks
  };
}

// Look up the locks belonging to the given public key hashes. All locks share the contract
// address, so one request covers every wallet address.
export async function fetchBadgerLocks(
  provider: ElectrumNetworkProvider,
  ownerPkhs: string[]
): Promise<BadgerLock[]> {
  if (!ownerPkhs.length) return [];
  const utxos = await provider.getUtxos(BADGERS_CONTRACT_ADDRESS);
  const locks: BadgerLock[] = [];
  for (const utxo of utxos) {
    const lock = lockFromUtxo(utxo, ownerPkhs);
    if (lock) locks.push(lock);
  }
  return locks;
}
