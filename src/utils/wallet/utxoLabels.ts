// Private labels on the wallet's own coins, stored in localStorage per wallet per network as an
// outpoint-keyed map. A label belongs to its outpoint: it survives freezing and unfreezing, and
// becomes unreachable once the coin is spent. Labels never leave the device.

import type { Outpoint } from "src/utils/wallet/reservedUtxos";

export const maxUtxoLabelLength = 100;

type Network = 'mainnet' | 'chipnet';

export type UtxoLabels = Record<Outpoint, string>;

function utxoLabelsKey(network: Network, walletName: string): string {
  return `utxoLabels-${network}-${walletName}`;
}

export function loadUtxoLabels(network: Network, walletName: string): UtxoLabels {
  const readLabels = localStorage.getItem(utxoLabelsKey(network, walletName));
  if (!readLabels) return {};
  try {
    return JSON.parse(readLabels) as UtxoLabels;
  } catch {
    return {};
  }
}

// Fresh read-modify-write: another tab may have written labels since this tab loaded them,
// so re-read before writing to only ever change the single outpoint in hand.
// An empty label deletes the entry. Returns the updated map for the caller's reactive state.
export function saveUtxoLabel(
  network: Network,
  walletName: string,
  outpoint: Outpoint,
  label: string
): UtxoLabels {
  const utxoLabels = loadUtxoLabels(network, walletName);
  const trimmedLabel = label.trim().slice(0, maxUtxoLabelLength);
  if (trimmedLabel) {
    utxoLabels[outpoint] = trimmedLabel;
  } else {
    delete utxoLabels[outpoint];
  }
  localStorage.setItem(utxoLabelsKey(network, walletName), JSON.stringify(utxoLabels));
  return utxoLabels;
}

// A future wallet created under the same name must not inherit the old wallet's labels
export function removeUtxoLabels(walletName: string) {
  for (const network of ['mainnet', 'chipnet'] as const) {
    localStorage.removeItem(utxoLabelsKey(network, walletName));
  }
}
