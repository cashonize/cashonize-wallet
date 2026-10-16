import { describe, expect, it } from 'vitest'
import { classifyBroadcastError, electrumTimeoutMessage } from '../src/utils/wallet/broadcastErrors'

// A rejection as Fulcrum sends it, which mainnet-js wraps in an Error of its message
const rejected = (reason: string) => new Error(`the transaction was rejected by network rules.\n\n${reason}\n`)

describe('classifyBroadcastError', () => {
  it.each([
    ['txn-mempool-conflict (code 18)', 'conflict'],
    ['Missing inputs', 'missing-inputs'],
    ['bad-txns-inputs-missingorspent (code 16)', 'missing-inputs'],
    ['bad-txns-nonfinal, non-final transaction (code 64)', 'not-yet-final'],
    ['non-BIP68-final (code 64)', 'not-yet-final'],
    ['min relay fee not met, 100 < 226 (code 66)', 'other'],
  ])('reads "%s" as %s', (reason, kind) => {
    expect(classifyBroadcastError(rejected(reason))).toBe(kind)
  })

  // mainnet-js v4 wraps its timeout string in an Error
  it('reads the electrum timeout error as a timeout', () => {
    expect(classifyBroadcastError(new Error(electrumTimeoutMessage))).toBe('timeout')
  })
})
