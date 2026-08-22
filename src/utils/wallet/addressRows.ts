// Shared row model for the HD address list views: the settings page overview and the
// WalletConnect address selector both render addresses from the wallet cache this way.

import { type HDWallet, type TestNetHDWallet, type Utxo } from 'mainnet-js';
import { GAP_SIZE } from 'src/utils/wallet/addressManagement';

export interface AddressRow {
  index: number;
  address: string;
  tokenAddress: string;
  balance: bigint;
  txCount: number;
  utxos: Utxo[];
}

function getAddressBalance(utxos: Utxo[]): bigint {
  return utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0n);
}

export function buildAddressRows(hdWallet: HDWallet | TestNetHDWallet, index: number, change: boolean): AddressRow[] {
  const cache = hdWallet.walletCache;
  const rawHistory = change ? hdWallet.changeRawHistory : hdWallet.depositRawHistory;
  const rows: AddressRow[] = [];
  for (let i = 0; i < index + GAP_SIZE; i++) {
    const entry = cache.getByIndex(i, change);
    rows.push({
      index: i,
      address: entry.address,
      tokenAddress: entry.tokenAddress,
      balance: getAddressBalance(entry.utxos),
      txCount: rawHistory[i]?.length ?? 0,
      utxos: entry.utxos,
    });
  }
  return rows;
}
