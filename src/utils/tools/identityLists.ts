// The lists the identities feature persists, all per wallet per network and all of them ids,
// categories or txids, in one localStorage shape. Nothing here knows what an authchain is.

type Network = 'mainnet' | 'chipnet';

const identityListKeys = {
  // identities the wallet follows, which is what gets resolved and reserved
  categories: 'identities',
  // what the user took off the list: a decision, so it is stored rather than re-derived, or the
  // automatic detection would put back on every open what the user just removed
  dismissed: 'dismissedIdentities',
  // listed by the wallet itself and not yet seen by the user, so a coin quietly becoming
  // unspendable is not the first they hear of it
  unseen: 'unseenIdentities',
  // authheads held and protected without a name: a BCH-only chain carries nothing on its identity
  // output to say which identity it is. Keyed by txid, so an authhead that moves earns a fresh walk.
  unnamed: 'unnamedAuthheads',
} as const;

export type IdentityList = keyof typeof identityListKeys;

function listKey(list: IdentityList, network: Network, walletName: string): string {
  return `${identityListKeys[list]}-${network}-${walletName}`;
}

function readList(key: string): string[] {
  const stored = localStorage.getItem(key);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as string[];
  } catch {
    return [];
  }
}

export function loadIdentityList(list: IdentityList, network: Network, walletName: string): string[] {
  return readList(listKey(list, network, walletName));
}

// Fresh read-modify-write throughout: another tab may have written since this one loaded, so every
// change re-reads and touches only the entries in hand. Returns the list for the caller's state.
export function addToIdentityList(
  list: IdentityList,
  network: Network,
  walletName: string,
  entries: string | string[],
): string[] {
  const key = listKey(list, network, walletName);
  const stored = readList(key);
  for (const entry of Array.isArray(entries) ? entries : [entries]) {
    if (!stored.includes(entry)) stored.push(entry);
  }
  localStorage.setItem(key, JSON.stringify(stored));
  return stored;
}

export function removeFromIdentityList(
  list: IdentityList,
  network: Network,
  walletName: string,
  entry: string,
): string[] {
  const key = listKey(list, network, walletName);
  const remaining = readList(key).filter(stored => stored !== entry);
  localStorage.setItem(key, JSON.stringify(remaining));
  return remaining;
}

export function clearIdentityList(list: IdentityList, network: Network, walletName: string) {
  localStorage.removeItem(listKey(list, network, walletName));
}

// Every identity list on both networks: a future wallet created under the same name must not
// inherit the old wallet's identities
export function removeIdentityData(walletName: string) {
  for (const network of ['mainnet', 'chipnet'] as const) {
    for (const list of Object.keys(identityListKeys) as IdentityList[]) {
      clearIdentityList(list, network, walletName);
    }
  }
}
