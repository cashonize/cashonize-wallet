import { describe, expect, it } from 'vitest'
import type { Utxo } from 'mainnet-js'
import { binToHex } from '@bitauth/libauth'

import {
  authGuardLockingBytecodes,
  authGuardRedeemScript,
  isAuthGuardOf,
  isAuthKey,
} from '../src/utils/tools/authGuard'

// Verified against mainnet: a real AuthGuard covenant and the key that opens it. Its spends carry
// exactly this redeem script in their unlocking bytecode.
const vector = {
  category: 'bcc5157eb69f0fcf80593c69ac08a3f28a1e726d55d0be6330ccaba4ed94c307',
  redeemScript: '2007c394eda4abcc3063bed0556d721e8af2a308ac693c5980cf0f9fb67e15c5bc51ce8851d0009d6300cdc0c7886851',
  lockingBytecode: 'a9146a59d6c4546b759fe4e67258bae954f03335f7a187', // the covenant's P2SH20 output
}

const nftUtxo = (category: string, commitment: string, capability: string, amount = 0n): Utxo => ({
  txid: 'aa'.repeat(32),
  vout: 0,
  satoshis: 1000n,
  address: 'bitcoincash:qtest',
  token: { category, amount, nft: { commitment, capability } },
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

// The standard's own verification: derive the covenant's locking bytecode from the category and
// compare it with the identity output's
describe('authGuardLockingBytecodes', () => {
  it('derives the verified mainnet covenant output', () => {
    expect(authGuardLockingBytecodes(vector.category).p2sh20).toBe(vector.lockingBytecode)
  })

  it('recognises an identity output at either hash length', () => {
    const forms = authGuardLockingBytecodes(vector.category)
    expect(isAuthGuardOf(vector.category, forms.p2sh20)).toBe(true)
    expect(isAuthGuardOf(vector.category, forms.p2sh32)).toBe(true)
    expect(forms.p2sh32).not.toBe(forms.p2sh20)
  })

  // another key's covenant, or a plain address, is not this identity's guard
  it('rejects any other output', () => {
    const otherGuard = authGuardLockingBytecodes('ab'.repeat(32)).p2sh20
    expect(isAuthGuardOf(vector.category, otherGuard)).toBe(false)
    expect(isAuthGuardOf(vector.category, `76a914${'ab'.repeat(20)}88ac`)).toBe(false)
  })
})

// What the covenant asks for at input 1: a token of the key's category carrying no amount, which
// with a 32 byte category on the covenant's side means an NFT without capability
describe('isAuthKey', () => {
  const key = 'bb'.repeat(32)

  it('takes an NFT of the key category with no amount and no capability, whatever its commitment', () => {
    expect(isAuthKey(nftUtxo(key, '00', 'none'), key)).toBe(true)
    expect(isAuthKey(nftUtxo(key, '', 'none'), key)).toBe(true)
    expect(isAuthKey(nftUtxo(key, 'deadbeef', 'none'), key)).toBe(true)
  })

  // an identity guarded by its own category shares that category with every NFT of the
  // collection; the commitment its genesis minted the key with tells the key apart
  it('takes only the minted commitment when the caller knows it', () => {
    expect(isAuthKey(nftUtxo(key, '00', 'none'), key, '00')).toBe(true)
    expect(isAuthKey(nftUtxo(key, 'deadbeef', 'none'), key, '00')).toBe(false)
  })

  it('rejects an NFT of another category', () => {
    expect(isAuthKey(nftUtxo('cc'.repeat(32), '00', 'none'), key)).toBe(false)
  })

  it('rejects an NFT with a capability, or one carrying an amount', () => {
    expect(isAuthKey(nftUtxo(key, '00', 'minting'), key)).toBe(false)
    expect(isAuthKey(nftUtxo(key, '00', 'mutable'), key)).toBe(false)
    expect(isAuthKey(nftUtxo(key, '00', 'none', 5n), key)).toBe(false)
  })

  it('rejects a coin that is not a token at all', () => {
    expect(isAuthKey({
      txid: 'aa'.repeat(32), vout: 0, satoshis: 1000n, address: 'bitcoincash:qtest',
    }, key)).toBe(false)
  })
})
