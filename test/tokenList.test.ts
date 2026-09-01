import { describe, expect, it } from 'vitest'
import type { Utxo } from 'mainnet-js'

import { tokenListFromUtxos } from '../src/stores/storeUtils'
import type { ReservedUtxos } from '../src/utils/wallet/reservedUtxos'

const category = '0123456789abcdef'.repeat(4)

const ftCoin = (vout: number, amount: bigint): Utxo =>
  ({ txid: 'aa'.repeat(32), vout, satoshis: 1000n, address: 'bitcoincash:qtest', token: { category, amount } })

const nftCoin = (vout: number, commitment: string): Utxo => ({
  txid: 'bb'.repeat(32), vout, satoshis: 1000n, address: 'bitcoincash:qtest',
  token: { category, amount: 0n, nft: { commitment, capability: 'none' } },
})

const held = (...utxos: Utxo[]): ReservedUtxos => Object.fromEntries(
  utxos.map(utxo => [`${utxo.txid}:${utxo.vout}`, { reason: 'manual' as const, satoshis: '1000', reservedAt: 1 }])
)

describe('tokenListFromUtxos', () => {
  it('counts every coin of a category while none is held back', () => {
    const list = tokenListFromUtxos([ftCoin(0, 500n), ftCoin(1, 700n)])

    expect(list).toEqual([{ category, amount: 1200n }])
  })

  // the balance says what the wallet can spend of a category, and a held back coin is not that
  it('leaves a held back coin out of the fungible balance', () => {
    const reserved = ftCoin(1, 700n)
    const list = tokenListFromUtxos([ftCoin(0, 500n), reserved], held(reserved))

    expect(list).toEqual([{ category, amount: 500n }])
  })

  // an NFT is not a balance: it is still held, and a send that names it is refused instead
  it('still lists a held back NFT', () => {
    const reserved = nftCoin(0, 'aa')
    const list = tokenListFromUtxos([reserved, nftCoin(1, 'bb')], held(reserved))

    expect(list).toEqual([{ category, nfts: [reserved, nftCoin(1, 'bb')] }])
  })
})
