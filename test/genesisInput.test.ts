import { describe, expect, it } from 'vitest'
import { BaseWallet } from 'mainnet-js'
import type { Utxo } from 'mainnet-js'

// The token creation page lets the user pick which coin the genesis spends, because that coin's
// txid becomes the category and is shown before anything is signed. mainnet-js takes the first
// vout-0 BCH coin of the pool it is handed, which is why store.spend.tokenGenesis puts the picked
// coin at the front. If that ever stops holding, the wallet would create a category other than the
// one the user chose and wrote their metadata against.
const coin = (txid: string, vout = 0, token?: Utxo['token']): Utxo =>
  ({ txid, vout, satoshis: 100_000n, token }) as Utxo

const cashaddr = 'bitcoincash:qr4aadjrpu73p2806w0sv6mgqfqs6saeqqrpg78rzt'

async function genesisCategoryOf(pool: Utxo[]) {
  let sentRequests: unknown[] = []
  const fakeWallet = {
    getUtxos: () => Promise.resolve(pool),
    getTokenDepositAddress: () => cashaddr,
    send: (requests: unknown[]) => {
      sentRequests = requests
      return Promise.resolve({})
    },
  }
  await (BaseWallet.prototype.tokenGenesis as unknown as (
    this: unknown, request: unknown, sendRequests: unknown[], options: unknown
  ) => Promise<unknown>).call(fakeWallet, { cashaddr, value: 1000n }, [], { utxoIds: pool })
  return (sentRequests[0] as { category: string }).category
}

describe('mainnet-js takes its genesis input from the front of the pool', () => {
  it('creates the category of the first vout-0 BCH coin handed to it', async () => {
    const picked = coin('a'.repeat(64))
    const other = coin('b'.repeat(64))
    expect(await genesisCategoryOf([picked, other])).toBe(picked.txid)
    expect(await genesisCategoryOf([other, picked])).toBe(other.txid)
  })

  it('skips coins a genesis cannot start from', async () => {
    const notOutputZero = coin('c'.repeat(64), 1)
    const tokenCoin = coin('d'.repeat(64), 0, { amount: 1n } as Utxo['token'])
    const eligible = coin('e'.repeat(64))
    expect(await genesisCategoryOf([notOutputZero, tokenCoin, eligible])).toBe(eligible.txid)
  })
})
