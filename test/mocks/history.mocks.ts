import type { InOutput, TransactionHistoryItem } from 'mainnet-js'

// History items the way mainnet-js builds them: every output decoded, an OP_RETURN output's
// address standing in as "OP_RETURN: <hex>", token fields as on a utxo. Coins are P2PKH unless a
// test gives one another lockingBytecode.

export const p2pkhBytecode = `76a914${'00'.repeat(20)}88ac`

export const opReturnOutput = (hex: string): InOutput => ({ address: `OP_RETURN: ${hex}`, value: 0 })

export const p2pkhOutput = (address = 'bitcoincash:qtest', value = 1000): InOutput => ({ address, value, lockingBytecode: p2pkhBytecode })

export const tokenOutput = (
  category: string,
  token: { amount?: bigint, commitment?: string, capability?: 'none' | 'mutable' | 'minting' } = {},
  address = 'bitcoincash:ztest',
): InOutput => ({
  address,
  value: 1000,
  lockingBytecode: p2pkhBytecode,
  token: {
    category,
    amount: token.amount ?? 0n,
    ...(token.commitment === undefined ? {} : { nft: { capability: token.capability ?? 'none', commitment: token.commitment } }),
  },
})

// An input as mainnet-js reports it: the outpoint it spends alongside the coin it spent, which is
// what identity detection reads to follow an authchain through the history
export const spendOf = (txid: string, vout: number, address = 'bitcoincash:qtest'): InOutput => ({
  address,
  value: 1000,
  lockingBytecode: p2pkhBytecode,
  outpointTransactionHash: txid,
  outpointIndex: vout,
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
