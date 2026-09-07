import { vi } from 'vitest'
import { binToHex, encodeTransaction, hexToBin } from '@bitauth/libauth'
import type { InOutput, TransactionHistoryItem } from 'mainnet-js'

// History items the way mainnet-js builds them: every output decoded, an OP_RETURN output's
// address standing in as "OP_RETURN: <hex>", token fields as on a utxo

export const opReturnOutput = (hex: string): InOutput => ({ address: `OP_RETURN: ${hex}`, value: 0 })

export const p2pkhOutput = (address = 'bitcoincash:qtest', value = 1000): InOutput => ({ address, value })

export const tokenOutput = (
  category: string,
  token: { amount?: bigint, commitment?: string } = {},
  address = 'bitcoincash:ztest',
): InOutput => ({
  address,
  value: 1000,
  token: {
    category,
    amount: token.amount ?? 0n,
    ...(token.commitment === undefined ? {} : { nft: { capability: 'none', commitment: token.commitment } }),
  },
})

export const historyItem = (hash: string, outputs: InOutput[], inputs: InOutput[] = [p2pkhOutput()]): TransactionHistoryItem => ({
  hash,
  inputs,
  outputs,
  blockHeight: 800_000,
  size: 250,
  fee: 300,
  balance: 0,
  valueChange: 0,
  tokenAmountChanges: [],
})

// The raw hex of a transaction spending the given outpoints, which is all identity detection
// reads off it: a history item carries no input outpoints, so a genesis is confirmed from its raw form
export function rawTransactionSpending(outpoints: { txid: string, vout: number }[]) {
  return binToHex(encodeTransaction({
    version: 2,
    locktime: 0,
    inputs: outpoints.map(({ txid, vout }) => ({
      outpointTransactionHash: hexToBin(txid),
      outpointIndex: vout,
      sequenceNumber: 0,
      unlockingBytecode: new Uint8Array(),
    })),
    outputs: [{ lockingBytecode: hexToBin('76a914' + '00'.repeat(20) + '88ac'), valueSatoshis: 1000n }],
  }))
}

// A fetcher of raw transactions by hash holding only the given ones, as the electrum cache would
export function rawTransactionsFetcher(known: Record<string, string>) {
  return vi.fn((hashes: string[]) => Promise.resolve(
    new Map(hashes.filter(hash => known[hash]).map(hash => [hash, known[hash]!]))
  ))
}
