// Shared row model for the HD address list views: the settings page overview and the
// WalletConnect address selector both render addresses from the wallet cache this way.

import { GAP_SIZE, type HDWallet, type Utxo } from '@cashonize/bch-wallet-lib';
import { reservedFromUtxos, type ReservedUtxos } from './reservedUtxos';

export interface AddressRow {
  index: number;
  address: string;
  tokenAddress: string;
  balance: bigint;
  spendableBalance: bigint; // balance minus the reserved part (utils/wallet/reservedUtxos.ts)
  reservedBalance: bigint;
  txCount: number;
  utxos: Utxo[];
}

function getAddressBalance(utxos: Utxo[]): bigint {
  return utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0n);
}

// The branch's addresses up to its gap window, DEPOSIT_BRANCH or CHANGE_BRANCH
export function buildAddressRows(
  hdWallet: HDWallet, branch: number, reservedUtxos: ReservedUtxos
): AddressRow[] {
  const cache = hdWallet.walletCache;
  const index = hdWallet.indices.get(branch) ?? 0;
  const rawHistory = hdWallet.rawHistory.get(branch) ?? [];
  const rows: AddressRow[] = [];
  for (let i = 0; i < index + GAP_SIZE; i++) {
    const entry = cache.getByIndex(i, branch);
    const balance = getAddressBalance(entry.utxos);
    const reservedBalance = getAddressBalance(reservedFromUtxos(entry.utxos, reservedUtxos));
    rows.push({
      index: i,
      address: entry.address,
      tokenAddress: entry.tokenAddress,
      balance,
      spendableBalance: balance - reservedBalance,
      reservedBalance,
      txCount: rawHistory[i]?.length ?? 0,
      utxos: entry.utxos,
    });
  }
  return rows;
}

export function tokenCategoryCount(row: AddressRow): number {
  const categories: string[] = [];
  for (const utxo of row.utxos) {
    const category = utxo.token?.category;
    if (category && !categories.includes(category)) categories.push(category);
  }
  return categories.length;
}

// From this many addresses in a list on, it gets a search field
export const addressSearchFrom = 8;

// Whether a row answers a search of the address lists: by its index, either form of its address
// (a pasted full one included, where the lists show them shortened), its label, or a token it
// holds. A query of digits alone is an index and no part of an address, which almost any digit is.
export function addressRowMatches(
  row: AddressRow, searchQuery: string, label: string | undefined, tokenText: (category: string) => string
): boolean {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return true;
  if (label?.toLowerCase().includes(query)) return true;
  const holdsMatchingToken = row.utxos.some((utxo) => {
    const category = utxo.token?.category;
    return category !== undefined && (category === query || tokenText(category).toLowerCase().includes(query));
  });
  if (holdsMatchingToken) return true;
  if (/^\d+$/.test(query)) return String(row.index) === query;
  return row.address.includes(query) || row.tokenAddress.includes(query);
}
