// The token identities this wallet keeps custody of, stored in localStorage per wallet per network
// as a list of categories. Everything else about an identity - which output currently is the
// authhead, the name, the icon - is resolved at runtime, because the authhead moves every time the
// identity's metadata is updated and those updates happen outside this wallet.

import type { Utxo } from "mainnet-js";
import { queryAuthHeadTxid } from "src/queryChainGraph";

type Network = 'mainnet' | 'chipnet';

// 'held' is the only state the wallet protects: the authhead is a BCH-only coin of this wallet, so
// it can be kept out of coin selection. 'carriesTokens' is an authhead this wallet holds that also
// carries tokens, which reservation does not yet cover. 'unresolved' is a failed Chaingraph query,
// which says nothing about where the authhead is.
export type IdentityStatus = 'held' | 'carriesTokens' | 'notHeld' | 'unresolved';

export interface IdentityState {
  category: string;
  authheadTxid?: string;
  authUtxo?: Utxo; // only set for 'held', the coin the 'auth' reservation is made on
  status: IdentityStatus;
}

function identitiesKey(network: Network, walletName: string): string {
  return `identities-${network}-${walletName}`;
}

export function loadIdentityCategories(network: Network, walletName: string): string[] {
  const readCategories = localStorage.getItem(identitiesKey(network, walletName));
  if (!readCategories) return [];
  try {
    return JSON.parse(readCategories) as string[];
  } catch {
    return [];
  }
}

// Fresh read-modify-write: another tab may have added or removed an identity since this tab loaded
// them, so re-read before writing to only ever change the single category in hand.
// Returns the updated list for the caller's reactive state.
export function saveIdentityCategory(network: Network, walletName: string, category: string): string[] {
  const categories = loadIdentityCategories(network, walletName);
  if (!categories.includes(category)) categories.push(category);
  localStorage.setItem(identitiesKey(network, walletName), JSON.stringify(categories));
  return categories;
}

// Same fresh read-modify-write approach as saveIdentityCategory.
export function deleteIdentityCategory(network: Network, walletName: string, category: string): string[] {
  const categories = loadIdentityCategories(network, walletName).filter(listed => listed !== category);
  localStorage.setItem(identitiesKey(network, walletName), JSON.stringify(categories));
  return categories;
}

// A future wallet created under the same name must not inherit the old wallet's identities
export function removeIdentityCategories(walletName: string) {
  for (const network of ['mainnet', 'chipnet'] as const) {
    localStorage.removeItem(identitiesKey(network, walletName));
  }
}

export function isTokenCategory(category: string): boolean {
  return /^[0-9a-f]{64}$/i.test(category);
}

// Resolves where each identity's authhead sits now and whether this wallet holds it. Queries run in
// parallel and a failed one only marks its own identity 'unresolved'; knownAuthheads lets a caller
// pass authheads already resolved this round so the same category is not queried twice.
export async function resolveIdentities(
  categories: string[],
  chaingraphUrl: string,
  walletUtxos: Utxo[],
  knownAuthheads: Record<string, string> = {},
): Promise<IdentityState[]> {
  const authheadResults = await Promise.allSettled(categories.map(category => {
    const knownAuthhead = knownAuthheads[category];
    if (knownAuthhead) return Promise.resolve(knownAuthhead);
    return queryAuthHeadTxid(category, chaingraphUrl);
  }));

  return categories.map((category, index) => {
    const result = authheadResults[index];
    if (result?.status === 'rejected') {
      console.error("Failed to resolve authchain identity:", category, result.reason);
    }
    if (result?.status !== 'fulfilled') return { category, status: 'unresolved' };
    const authheadTxid = result.value;
    // The authhead is always output 0 of the authchain's latest transaction
    const authUtxo = walletUtxos.find(utxo => utxo.txid === authheadTxid && utxo.vout === 0);
    if (!authUtxo) return { category, authheadTxid, status: 'notHeld' };
    if (authUtxo.token) return { category, authheadTxid, status: 'carriesTokens' };
    return { category, authheadTxid, authUtxo, status: 'held' };
  });
}
