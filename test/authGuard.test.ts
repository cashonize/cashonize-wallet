import { describe, expect, it } from 'vitest'
import type { Utxo } from 'mainnet-js'
import { binToHex, encodeCashAddress, hash256 } from '@bitauth/libauth'

import {
  authGuardAddresses,
  authGuardRedeemScript,
  guardContentsFromUtxos,
  isAuthKeyCandidate,
} from '../src/utils/tools/authGuard'

// Verified against mainnet: a real AuthGuard covenant and the key that opens it. Its spends carry
// exactly this redeem script in their unlocking bytecode.
const vector = {
  category: 'bcc5157eb69f0fcf80593c69ac08a3f28a1e726d55d0be6330ccaba4ed94c307',
  redeemScript: '2007c394eda4abcc3063bed0556d721e8af2a308ac693c5980cf0f9fb67e15c5bc51ce8851d0009d6300cdc0c7886851',
  address: 'bitcoincash:pp49n4ky234ht8lyuee93whf2ncrxd0h5y8k8sw3t3',
  tokenAddress: 'bitcoincash:rp49n4ky234ht8lyuee93whf2ncrxd0h5yqu5wqh5z',
}

const nftUtxo = (commitment: string, capability: string): Utxo => ({
  txid: 'aa'.repeat(32),
  vout: 0,
  satoshis: 1000n,
  address: 'bitcoincash:qtest',
  token: { category: 'bb'.repeat(32), amount: 0n, nft: { commitment, capability } },
} as Utxo)

describe('authGuardRedeemScript', () => {
  // the category is byte-reversed, which is the half of this most easily got wrong
  it('assembles the script of the verified mainnet covenant', () => {
    expect(binToHex(authGuardRedeemScript(vector.category))).toBe(vector.redeemScript)
  })

  it('is the length the standard describes', () => {
    // one push opcode, the 32 byte category, the 15 byte body
    expect(authGuardRedeemScript(vector.category).length).toBe(48)
  })
})

describe('authGuardAddresses', () => {
  it('derives the verified mainnet covenant address', () => {
    expect(authGuardAddresses(vector.category, 'bitcoincash').p2sh20).toBe(vector.tokenAddress)
  })

  // no live P2SH32 deployment to check against, but the encoding is determined by the same redeem
  // script, so the expectation is computed rather than quoted
  it('derives the P2SH32 address of the same redeem script', () => {
    const expected = encodeCashAddress({
      prefix: 'bitcoincash',
      type: 'p2shWithTokens',
      payload: hash256(authGuardRedeemScript(vector.category)),
      throwErrors: true,
    }).address

    expect(authGuardAddresses(vector.category, 'bitcoincash').p2sh32).toBe(expected)
    expect(authGuardAddresses(vector.category, 'bitcoincash').p2sh32).not.toBe(vector.tokenAddress)
  })

  it('derives on the network it is asked for', () => {
    expect(authGuardAddresses(vector.category, 'bchtest').p2sh20).toMatch(/^bchtest:/)
  })
})

describe('isAuthKeyCandidate', () => {
  it('recognises the shape of an AuthKey', () => {
    expect(isAuthKeyCandidate(nftUtxo('00', 'none'))).toBe(true)
  })

  // the fingerprint is local and cheap, so it is deliberately narrow: anything else is not a
  // candidate, and a candidate is only confirmed once its covenant is found to hold something
  it('rejects an NFT that is not shaped like one', () => {
    expect(isAuthKeyCandidate(nftUtxo('', 'none'))).toBe(false)
    expect(isAuthKeyCandidate(nftUtxo('00', 'minting'))).toBe(false)
  })

  it('rejects an NFT carrying a fungible amount', () => {
    const withAmount = nftUtxo('00', 'none')
    withAmount.token!.amount = 5n

    expect(isAuthKeyCandidate(withAmount)).toBe(false)
  })

  it('rejects a coin that is not a token at all', () => {
    expect(isAuthKeyCandidate({
      txid: 'aa'.repeat(32), vout: 0, satoshis: 1000n, address: 'bitcoincash:qtest',
    })).toBe(false)
  })
})

describe('guardContentsFromUtxos', () => {
  const guarded = (vout: number, category?: string): Utxo => ({
    txid: 'cc'.repeat(32),
    vout,
    satoshis: 1000n,
    address: 'bitcoincash:qguard',
    ...(category ? { token: { category, amount: 100n } } : {}),
  })

  it('names the identity a guarded output belongs to', () => {
    const output = guarded(0, 'dd'.repeat(32))

    expect(guardContentsFromUtxos([output])).toEqual({
      identified: [{ utxo: output, category: 'dd'.repeat(32) }],
      unidentified: 0,
    })
  })

  // the identity output is output 0; anyone can pay the covenant address, and those coins are not
  it('ignores coins at the address that are not the identity output', () => {
    expect(guardContentsFromUtxos([guarded(1, 'dd'.repeat(32))]))
      .toEqual({ identified: [], unidentified: 0 })
  })

  // naming this one needs a lookup back from its txid, which this version cannot do; a key that
  // guards only such an output still guards something, so it is counted rather than dropped
  it('counts a guarded output it cannot name yet', () => {
    expect(guardContentsFromUtxos([guarded(0)])).toEqual({ identified: [], unidentified: 1 })
  })
})
