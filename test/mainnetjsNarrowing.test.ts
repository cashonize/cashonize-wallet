import { describe, expect, it } from 'vitest'
import { BaseWallet } from 'mainnet-js'

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
