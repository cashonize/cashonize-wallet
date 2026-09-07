import { describe, expect, it } from 'vitest'
import { BaseWallet, FeePaidByEnum, SendRequest } from 'mainnet-js'
import type { Utxo } from 'mainnet-js'
// not on the package's export surface, so reached by path
import { getSuitableUtxos } from '../node_modules/mainnet-js/dist/module/transaction/Wif.js'

// The wallet keeps frozen and reserved coins out of a spend by narrowing mainnet-js's pool with
// the utxoIds option, so every method that selects inputs has to honor it. tokenMint and tokenBurn
// only do because of the pnpm patch (see pnpm-workspace.yaml): if it ever stops applying, a held
// back token coin quietly becomes mintable from and burnable again, with nothing else to notice.
// checkUtxos is the call that does the narrowing, so its presence is what these look for.
const narrowingMethods = [
  '_getMaxAmountToSend', // sendMax and getMaxAmountToSend both go through it
  'encodeTransaction', // every send(), token requests included; the wallet classes delegate here
  'tokenGenesis',
  'tokenMint', // patched
  'tokenBurn', // patched
] as const

describe('mainnet-js narrows its input selection to options.utxoIds', () => {
  for (const method of narrowingMethods) {
    it(`${method} narrows the utxos it selects from`, () => {
      const source = (BaseWallet.prototype as unknown as Record<string, () => unknown>)[method]?.toString()
      expect(source).toBeDefined()
      expect(source).toContain('checkUtxos')
    })
  }
})

// The store's spend explainer appends the held-back reason to mainnet-js's shortfall messages,
// matched by their opening words, so a rewording upstream would silently drop the explanation
const shortfallMessages = [
  { method: 'encodeTransaction', message: 'Not enough token amount to send' },
  { method: 'encodeTransaction', message: 'There were no Unspent Outputs' },
  { method: 'encodeTransaction', message: "The available inputs couldn't satisfy the request with fees" },
  { method: 'tokenMint', message: 'You do not have any token UTXOs with minting capability for specified category' },
  { method: 'tokenBurn', message: 'You do not have suitable token UTXOs to perform burn' },
] as const

describe('mainnet-js still reports a shortfall in the words the explainer matches', () => {
  for (const { method, message } of shortfallMessages) {
    it(`${method} says "${message}"`, () => {
      const source = (BaseWallet.prototype as unknown as Record<string, () => unknown>)[method]?.toString()
      expect(source).toContain(message)
    })
  }

  it('getSuitableUtxos says "Amount required was not met"', () => {
    expect(getSuitableUtxos.toString()).toContain('Amount required was not met')
  })
})

// The sweep at the end of transferring all assets hands sendMax a pool that still holds token
// UTXOs, trusting that the plain-BCH selection never takes one: a token UTXO swept as plain BCH
// would burn its tokens. sendMax picks its inputs here, so this is where that has to hold.
describe('mainnet-js never funds a plain BCH send from a token UTXO', () => {
  it('getSuitableUtxos leaves a token UTXO out of a plain send', async () => {
    const address = 'bitcoincash:qtest'
    const bch: Utxo = { txid: '11'.repeat(32), vout: 0, satoshis: 10_000n, address }
    const tokenCoin: Utxo = { txid: '22'.repeat(32), vout: 0, satoshis: 100_000n, address, token: { category: '33'.repeat(32), amount: 5n } }
    const request = new SendRequest({ cashaddr: address, value: 1000n })

    const selected = await getSuitableUtxos([tokenCoin, bch], undefined, 0, FeePaidByEnum.change, [request])

    expect(selected).toEqual([bch])
  })
})
