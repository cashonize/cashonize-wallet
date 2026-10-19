import { describe, expect, it } from 'vitest'
import { BroadcastRejectedError, BroadcastTimeoutError, ElectrumTimeoutError } from '@cashonize/bch-wallet-lib'
import { classifyBroadcastError } from '../src/utils/wallet/broadcastErrors'

// A refusal as the library throws it: the server's text as the message, the node's reason parsed out
const rejected = (reason: string, details = '') =>
  new BroadcastRejectedError(`the transaction was rejected by network rules.\n\n${reason}${details}\n`, { reason })

describe('classifyBroadcastError', () => {
  it.each([
    ['txn-mempool-conflict', 'conflict'],
    ['Missing inputs', 'missing-inputs'],
    ['bad-txns-inputs-missingorspent', 'missing-inputs'],
    ['bad-txns-nonfinal', 'not-yet-final'],
    ['non-BIP68-final', 'not-yet-final'],
    ['min relay fee not met', 'other'],
  ])('reads the reason "%s" as %s', (reason, kind) => {
    expect(classifyBroadcastError(rejected(reason))).toBe(kind)
  })

  it('reads a timed out broadcast as a timeout', () => {
    expect(classifyBroadcastError(new ElectrumTimeoutError('electrum request timed out'))).toBe('timeout')
  })

  // the server took the broadcast but neither reported nor holds the transaction: it may still go through
  it('reads a broadcast the server never confirmed as unconfirmed', () => {
    expect(classifyBroadcastError(new BroadcastTimeoutError('not reported', { txid: 'ab'.repeat(32), transaction: '0200' }))).toBe('unconfirmed')
  })

  // a lost connection or any other error is no refusal, whatever its text says
  it('reads only a refusal by its reason, not an error by its message', () => {
    const lookalike = new Error('the transaction was rejected by network rules.\n\ntxn-mempool-conflict (code 18)\n')
    expect(classifyBroadcastError(lookalike)).toBe('other')
  })
})
