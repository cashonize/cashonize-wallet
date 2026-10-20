// Shared row model for the HD address list views: the settings page overview and the
// WalletConnect address selector both render addresses from the wallet cache this way.

import { GAP_SIZE, type HDWallet, type TestNetHDWallet, type Utxo } from '@cashonize/bch-wallet-lib';
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
  hdWallet: HDWallet | TestNetHDWallet, branch: number, reservedUtxos: ReservedUtxos
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
