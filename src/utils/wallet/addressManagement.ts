// Address management for HD wallets: addresses the user marked as used (so the wallet hands
// out a fresh receive address), address labels and frozen addresses. All are stored in
// localStorage per wallet per network as cashaddr-keyed data; they never leave the device.

export const maxAddressLabelLength = 100;

type Network = 'mainnet' | 'chipnet';

function addressMarksKey(network: Network, walletName: string): string {
  return `addressMarks-${network}-${walletName}`;
}

function addressLabelsKey(network: Network, walletName: string): string {
  return `addressLabels-${network}-${walletName}`;
}

function frozenAddressesKey(network: Network, walletName: string): string {
  return `frozenAddresses-${network}-${walletName}`;
}

export function loadAddressMarks(network: Network, walletName: string): string[] {
  const readMarks = localStorage.getItem(addressMarksKey(network, walletName));
  if (!readMarks) return [];
  try {
    return JSON.parse(readMarks) as string[];
  } catch {
    return [];
  }
}

// Fresh read-modify-write: another tab may have written marks since this tab loaded them,
// so re-read before writing to only ever change the single address being marked.
// Returns the updated list for the caller's reactive state.
export function saveAddressMark(network: Network, walletName: string, address: string): string[] {
  const addressMarks = loadAddressMarks(network, walletName);
  if (!addressMarks.includes(address)) addressMarks.push(address);
  localStorage.setItem(addressMarksKey(network, walletName), JSON.stringify(addressMarks));
  return addressMarks;
}

export function deleteAddressMark(network: Network, walletName: string, address: string): string[] {
  const addressMarks = loadAddressMarks(network, walletName).filter(marked => marked !== address);
  localStorage.setItem(addressMarksKey(network, walletName), JSON.stringify(addressMarks));
  return addressMarks;
}

export function loadAddressLabels(network: Network, walletName: string): Record<string, string> {
  const readLabels = localStorage.getItem(addressLabelsKey(network, walletName));
  if (!readLabels) return {};
  try {
    return JSON.parse(readLabels) as Record<string, string>;
  } catch {
    return {};
  }
}

// Same fresh read-modify-write approach as saveAddressMark.
// An empty label deletes the entry. Returns the updated map for the caller's reactive state.
export function saveAddressLabel(
  network: Network,
  walletName: string,
  address: string,
  label: string
): Record<string, string> {
  const addressLabels = loadAddressLabels(network, walletName);
  const trimmedLabel = label.trim().slice(0, maxAddressLabelLength);
  if (trimmedLabel) {
    addressLabels[address] = trimmedLabel;
  } else {
    delete addressLabels[address];
  }
  localStorage.setItem(addressLabelsKey(network, walletName), JSON.stringify(addressLabels));
  return addressLabels;
}

// A frozen address holds back every coin on it, the ones it receives later included, so the
// freeze is kept by address rather than as the outpoints it holds now (see reservedUtxos.ts)
export function loadFrozenAddresses(network: Network, walletName: string): string[] {
  const readFrozen = localStorage.getItem(frozenAddressesKey(network, walletName));
  if (!readFrozen) return [];
  try {
    return JSON.parse(readFrozen) as string[];
  } catch {
    return [];
  }
}

// Same fresh read-modify-write approach as saveAddressMark.
export function saveFrozenAddress(network: Network, walletName: string, address: string): string[] {
  const frozenAddresses = loadFrozenAddresses(network, walletName);
  if (!frozenAddresses.includes(address)) frozenAddresses.push(address);
  localStorage.setItem(frozenAddressesKey(network, walletName), JSON.stringify(frozenAddresses));
  return frozenAddresses;
}

export function deleteFrozenAddress(network: Network, walletName: string, address: string): string[] {
  const frozenAddresses = loadFrozenAddresses(network, walletName).filter(frozen => frozen !== address);
  localStorage.setItem(frozenAddressesKey(network, walletName), JSON.stringify(frozenAddresses));
  return frozenAddresses;
}

// A future wallet created under the same name must not inherit the old wallet's data
export function removeAddressManagementData(walletName: string) {
  for (const network of ['mainnet', 'chipnet'] as const) {
    localStorage.removeItem(addressMarksKey(network, walletName));
    localStorage.removeItem(addressLabelsKey(network, walletName));
    localStorage.removeItem(frozenAddressesKey(network, walletName));
  }
}

// The receive address to hand out: the first address that is neither used on-chain nor skipped
// (marked as used or frozen), staying within gapSize of the last used address. A seed restore
// stops scanning there, so a payment beyond it would never be found. Returns undefined when every
// address in that window is skipped, callers should then fall back to the wallet's own default.
export function deriveFreshAddressIndex(
  isAddressUsed: (index: number) => boolean,
  addressAtIndex: (index: number) => string,
  skippedAddresses: string[],
  gapSize: number,
): number | undefined {
  let lastUsedIndex = -1;
  for (let index = 0; index <= lastUsedIndex + gapSize; index++) {
    if (isAddressUsed(index)) {
      lastUsedIndex = index;
      continue;
    }
    if (!skippedAddresses.includes(addressAtIndex(index))) return index;
  }
  return undefined;
}
