// Address management for HD wallets: addresses the user marked as used (so the wallet hands
// out a fresh receive address) and private address labels. Both are stored in localStorage
// per wallet per network as cashaddr-keyed data; they never leave the device.

export const maxAddressLabelLength = 100;

type Network = 'mainnet' | 'chipnet';

function addressMarksKey(network: Network, walletName: string): string {
  return `addressMarks-${network}-${walletName}`;
}

function addressLabelsKey(network: Network, walletName: string): string {
  return `addressLabels-${network}-${walletName}`;
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

// A future wallet created under the same name must not inherit the old wallet's data
export function removeAddressManagementData(walletName: string) {
  for (const network of ['mainnet', 'chipnet'] as const) {
    localStorage.removeItem(addressMarksKey(network, walletName));
    localStorage.removeItem(addressLabelsKey(network, walletName));
  }
}

// The receive address to hand out: the first address that is neither used on-chain nor marked
// as used. Restoring the wallet from seed scans a fixed gap of unused addresses before giving
// up, so the result is clamped to within gapSize of the first on-chain-unused address; an
// address beyond that could receive a payment the restored wallet would never discover.
// Returns undefined when every address in that window is marked, callers should then fall
// back to the wallet's own default address.
export function deriveFreshAddressIndex(
  isAddressUsed: (index: number) => boolean,
  addressAtIndex: (index: number) => string,
  markedAddresses: string[],
  gapSize: number,
): number | undefined {
  let firstUnusedIndex: number | undefined;
  for (let index = 0; firstUnusedIndex === undefined || index < firstUnusedIndex + gapSize; index++) {
    if (isAddressUsed(index)) continue;
    if (firstUnusedIndex === undefined) firstUnusedIndex = index;
    if (!markedAddresses.includes(addressAtIndex(index))) return index;
  }
  return undefined;
}
