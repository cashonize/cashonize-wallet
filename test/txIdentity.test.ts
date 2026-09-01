import { describe, expect, it } from 'vitest'
import type { TransactionHistoryItem } from 'mainnet-js'
import { identityOperationOf } from '../src/utils/history/txIdentity'

const category = 'aa'.repeat(32)
const genesis = 'bb'.repeat(32)
const update = 'cc'.repeat(32)
const unrelated = 'dd'.repeat(32)

const transaction = (hash: string) => ({ hash } as TransactionHistoryItem)
const identities = [{ category, links: [genesis, update] }]

describe('identityOperationOf', () => {
  it('names a transaction belonging to a listed identity', () => {
    expect(identityOperationOf(transaction(update), identities, []))
      .toEqual({ category, kind: 'identityOperation' })
  })

  // the history item carries addresses and values, so the OP_RETURN that says this published
  // metadata is invisible to it; the walk that already read it says so instead
  it('calls it a metadata update when the walk saw a publication in it', () => {
    expect(identityOperationOf(transaction(update), identities, [update]))
      .toEqual({ category, kind: 'metadataUpdate' })
  })

  it('leaves an ordinary transaction alone', () => {
    expect(identityOperationOf(transaction(unrelated), identities, [])).toBeUndefined()
  })

  // an identity whose chain has not been resolved yet names nothing rather than everything
  it('leaves everything alone while a chain is unknown', () => {
    expect(identityOperationOf(transaction(update), [{ category }], [])).toBeUndefined()
  })
})
