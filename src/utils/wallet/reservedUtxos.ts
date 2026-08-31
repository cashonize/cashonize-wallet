// Coins held back from the wallet's own coin selection, stored in localStorage per wallet per
// network as an outpoint-keyed map. A reservation is local and advisory: it keeps a coin out of
// the pool this app spends from, it does not protect the coin on chain.

import type { Utxo } from "mainnet-js";
import { binToHex } from "@bitauth/libauth";

type Network = 'mainnet' | 'chipnet';

// 'manual' is the user freezing a coin themselves and is theirs to undo; 'pledge' and 'auth' are
// held by a feature, and are released through that feature rather than by unfreezing them here:
// a pledge by cancelling it, an authhead by transferring the identity or removing it from the
// identities page
export type ReservationReason = 'pledge' | 'manual' | 'auth';

export interface ReservedUtxo {
  reason: ReservationReason;
  // stored as a string because utxo.satoshis is a bigint, which JSON.stringify throws on
  satoshis: string;
  reservedAt: number; // unix seconds
}

// "txid:vout", the same outpoint form mainnet-js accepts for utxoIds
export type Outpoint = string;

export type ReservedUtxos = Record<Outpoint, ReservedUtxo>;

function reservedUtxosKey(network: Network, walletName: string): string {
  return `reservedUtxos-${network}-${walletName}`;
}

export function outpointOf(utxo: Utxo): Outpoint {
  return `${utxo.txid}:${utxo.vout}`;
}

export function loadReservedUtxos(network: Network, walletName: string): ReservedUtxos {
  const readReserved = localStorage.getItem(reservedUtxosKey(network, walletName));
  if (!readReserved) return {};
  try {
    return JSON.parse(readReserved) as ReservedUtxos;
  } catch {
    return {};
  }
}

// Fresh read-modify-write: another tab may have written reservations since this tab loaded them,
// so re-read before writing to only ever change the single outpoint in hand.
// Returns the updated map for the caller's reactive state.
export function saveReservedUtxo(
  network: Network,
  walletName: string,
  utxo: Utxo,
  reason: ReservationReason,
  reservedAt: number,
): ReservedUtxos {
  const reservedUtxos = loadReservedUtxos(network, walletName);
  reservedUtxos[outpointOf(utxo)] = {
    reason,
    satoshis: utxo.satoshis.toString(),
    reservedAt,
  };
  localStorage.setItem(reservedUtxosKey(network, walletName), JSON.stringify(reservedUtxos));
  return reservedUtxos;
}

// Same fresh read-modify-write approach as saveReservedUtxo.
export function deleteReservedUtxo(
  network: Network,
  walletName: string,
  outpoint: Outpoint,
): ReservedUtxos {
  const reservedUtxos = loadReservedUtxos(network, walletName);
  delete reservedUtxos[outpoint];
  localStorage.setItem(reservedUtxosKey(network, walletName), JSON.stringify(reservedUtxos));
  return reservedUtxos;
}

// A future wallet created under the same name must not inherit the old wallet's reservations
export function removeReservedUtxos(walletName: string) {
  for (const network of ['mainnet', 'chipnet'] as const) {
    localStorage.removeItem(reservedUtxosKey(network, walletName));
  }
}

// The coins the wallet may spend, which every spend path narrows mainnet-js's selection through
export function spendableFromUtxos(utxos: Utxo[], reservedUtxos: ReservedUtxos): Utxo[] {
  if (!Object.keys(reservedUtxos).length) return utxos;
  return utxos.filter(utxo => !(outpointOf(utxo) in reservedUtxos));
}

// Shorter than reservedUtxos whenever a reservation outlived the coin it was made for
export function reservedFromUtxos(utxos: Utxo[], reservedUtxos: ReservedUtxos): Utxo[] {
  if (!Object.keys(reservedUtxos).length) return [];
  return utxos.filter(utxo => outpointOf(utxo) in reservedUtxos);
}

// WalletConnect and WizardConnect dApps find coins on chain rather than being handed a pool, so
// there is no way to withhold a reserved coin from them and signing is the only place to refuse.
// libauth's decodeTransaction already reverses outpointTransactionHash, so it hex-encodes to the
// same txid form reservations are keyed by.
// The hash arrives as a Uint8Array from libauth and from the wizardconnect schema, which converts
// the hex form on parse; a string is accepted because the request types still allow one.
export function reservedTransactionInputs(
  inputs: readonly { outpointTransactionHash: Uint8Array | string; outpointIndex: number }[],
  reservedUtxos: ReservedUtxos,
): Outpoint[] {
  if (!Object.keys(reservedUtxos).length) return [];
  const inputOutpoints = inputs.map(input => {
    const { outpointTransactionHash } = input;
    const txid = typeof outpointTransactionHash === "string" ? outpointTransactionHash : binToHex(outpointTransactionHash);
    return `${txid}:${input.outpointIndex}`;
  });
  return inputOutpoints.filter(outpoint => outpoint in reservedUtxos);
}
