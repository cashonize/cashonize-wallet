// What this wallet signed for connected dapps, stored in localStorage per wallet per network,
// newest first. It replaces a dialog per signed transaction, which stacked up during the many
// transaction flows of dapps like ParyonUSD, so a toast can disappear without the record going.
// Signed-only entries are matched against the wallet history by txid: whether the dapp
// broadcast them shows there, not here.

type Network = 'mainnet' | 'chipnet';

export type DappActivityOutcome = 'sent' | 'signed' | 'broadcastFailed' | 'messageSigned';

export interface DappActivityEntry {
  /** Unix time in milliseconds */
  time: number;
  protocol: 'walletconnect' | 'wizardconnect';
  dappName: string;
  /** The dapp's own description of the transaction, unverified */
  userPrompt?: string | undefined;
  /** Absent for a signed message */
  txid?: string;
  outcome: DappActivityOutcome;
}

// Old entries drop off the end, a ParyonUSD payout claim alone can sign dozens
const maxEntries = 500;

function dappActivityKey(network: Network, walletName: string): string {
  return `dappActivity-${network}-${walletName}`;
}

export function loadDappActivity(network: Network, walletName: string): DappActivityEntry[] {
  const readDappActivity = localStorage.getItem(dappActivityKey(network, walletName));
  if (!readDappActivity) return [];
  try {
    const parsed: unknown = JSON.parse(readDappActivity);
    return Array.isArray(parsed) ? parsed as DappActivityEntry[] : [];
  } catch {
    return [];
  }
}

// Fresh read-modify-write: another tab may have logged activity since this tab loaded it.
// Returns the updated list for the caller's reactive state.
export function appendDappActivity(
  network: Network,
  walletName: string,
  entry: DappActivityEntry
): DappActivityEntry[] {
  const dappActivity = [entry, ...loadDappActivity(network, walletName)].slice(0, maxEntries);
  localStorage.setItem(dappActivityKey(network, walletName), JSON.stringify(dappActivity));
  return dappActivity;
}

export function clearDappActivity(network: Network, walletName: string) {
  localStorage.removeItem(dappActivityKey(network, walletName));
}

// A future wallet created under the same name must not inherit the old wallet's activity
export function removeDappActivity(walletName: string) {
  clearDappActivity('mainnet', walletName);
  clearDappActivity('chipnet', walletName);
}
