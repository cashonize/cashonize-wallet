import { describe, expect, it } from 'vitest'
import { BaseWallet, TokenSendRequest } from 'mainnet-js'
import type { Utxo } from 'mainnet-js'

// The token creation page lets the user pick which coin the genesis spends, because that coin's
// txid becomes the category and is shown before anything is signed. mainnet-js takes the first
// vout-0 BCH coin of the pool it is handed, which is why store.spend.tokenGenesis puts the picked
// coin at the front. If that ever stops holding, the wallet would create a category other than the
// one the user chose and wrote their metadata against.
const coin = (txid: string, vout = 0, token?: Utxo['token']): Utxo =>
  ({ txid, vout, satoshis: 100_000n, token }) as Utxo

const cashaddr = 'bitcoincash:qr4aadjrpu73p2806w0sv6mgqfqs6saeqqrpg78rzt'

async function genesisRequestsOf(pool: Utxo[], request: Record<string, unknown> = {}) {
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
  ) => Promise<unknown>).call(fakeWallet, { cashaddr, value: 1000n, ...request }, [], { utxoIds: pool })
  return sentRequests
}

async function genesisCategoryOf(pool: Utxo[]) {
  const requests = await genesisRequestsOf(pool)
  return (requests[0] as { category: string }).category
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

// The creation form refuses to issue the whole supply without also creating a minting NFT, because
// output 0 of a genesis is always a token output and one carrying neither an amount nor an NFT is
// not a valid token output. If mainnet-js ever leaves output 0 plain, that refusal stops being
// necessary and the form would be turning down a genesis the library can build.
describe('mainnet-js always makes output 0 of a genesis a token output', () => {
  it('keeps output 0 a token output even with nothing to carry', async () => {
    const requests = await genesisRequestsOf([coin('f'.repeat(64))], { amount: 0n })
    expect(requests[0]).toBeInstanceOf(TokenSendRequest)
    expect((requests[0] as TokenSendRequest).amount).toBe(0n)
    expect((requests[0] as TokenSendRequest).nft).toBeUndefined()
  })
})
