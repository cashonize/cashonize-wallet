import { describe, expect, it } from 'vitest'
import { detectIdentities } from '../src/utils/tools/identityDetection'
import { historyItem, opReturnOutput, p2pkhOutput, tokenOutput, rawTransactionSpending, rawTransactionsFetcher } from './mocks/history.mocks'

const genesisInputTxid = 'aa'.repeat(32)
const spenderTxid = 'bb'.repeat(32)
const otherCategory = 'cc'.repeat(32)
// OP_RETURN, a push of "BCMR", then the hash and locations
const publicationHex = `6a0442434d5220${'11'.repeat(32)}0b6578616d706c652e636f6d`

// the outpoint transaction is in the history, as any transaction paying the wallet is
const fundingItem = historyItem(genesisInputTxid, [p2pkhOutput(), p2pkhOutput()])

describe('detectIdentities', () => {
  // a genesis names its own authbase: the category is the outpoint it consumed
  it('finds a token these keys genesised', async () => {
    const history = [
      fundingItem,
      historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })]),
    ]
    const fetcher = rawTransactionsFetcher({ [spenderTxid]: rawTransactionSpending([{ txid: genesisInputTxid, vout: 0 }]) })

    const detected = await detectIdentities(history, fetcher)

    expect(detected.identities).toEqual([
      { authheadTxid: spenderTxid, category: genesisInputTxid, marker: 'genesis' },
    ])
    // only the candidate is decoded, never the history at large
    expect(fetcher).toHaveBeenCalledWith([spenderTxid])
  })

  // only a vout-0 outpoint can be a genesis input; a token whose category is a transaction of
  // this history but that spent a later output of it is a token sent onward
  it('does not read a genesis off a spend of a later output', async () => {
    const history = [
      fundingItem,
      historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })]),
    ]
    const fetcher = rawTransactionsFetcher({ [spenderTxid]: rawTransactionSpending([{ txid: genesisInputTxid, vout: 1 }]) })

    expect((await detectIdentities(history, fetcher)).identities).toEqual([])
  })

  // a token sent onward is not a token created: the category is somebody else's outpoint
  it('does not read a genesis off an ordinary token send', async () => {
    const history = [
      fundingItem,
      historyItem(spenderTxid, [tokenOutput(otherCategory, { amount: 1000n })]),
    ]
    const fetcher = rawTransactionsFetcher({})

    expect((await detectIdentities(history, fetcher)).identities).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('finds a metadata publication these keys made, named by its identity output', async () => {
    const history = [historyItem(spenderTxid, [
      tokenOutput(otherCategory, { amount: 500n }),
      p2pkhOutput(),
      opReturnOutput(publicationHex),
    ])]

    const detected = await detectIdentities(history, rawTransactionsFetcher({}))

    expect(detected.identities).toEqual([
      { authheadTxid: spenderTxid, category: otherCategory, marker: 'publication' },
    ])
    expect(detected.publicationTxids).toEqual([spenderTxid])
  })

  // a BCH-only chain has nothing on its identity output to name it; it is protected first and
  // named afterwards from the registry its publication points at
  it('finds a publication on a BCH-only chain, unnamed', async () => {
    const history = [historyItem(spenderTxid, [p2pkhOutput(), opReturnOutput(publicationHex)])]

    expect((await detectIdentities(history, rawTransactionsFetcher({}))).identities).toEqual([
      { authheadTxid: spenderTxid, marker: 'publication' },
    ])
  })

  it('ignores a transaction that is neither', async () => {
    const history = [historyItem(spenderTxid, [p2pkhOutput(), p2pkhOutput()])]

    expect((await detectIdentities(history, rawTransactionsFetcher({}))).identities).toEqual([])
  })

  // the genesis marker is the more informative one, so it is not overwritten by the other
  it('prefers the genesis reading when a transaction is both', async () => {
    const history = [
      fundingItem,
      historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { amount: 1000n }), opReturnOutput(publicationHex)]),
    ]
    const fetcher = rawTransactionsFetcher({ [spenderTxid]: rawTransactionSpending([{ txid: genesisInputTxid, vout: 0 }]) })

    const detected = await detectIdentities(history, fetcher)

    expect(detected.identities[0]?.marker).toBe('genesis')
    expect(detected.publicationTxids).toEqual([spenderTxid])
  })

  // a candidate that turns out to be a token sent onward keeps its publication reading
  it('keeps the publication reading of a candidate that was no genesis', async () => {
    const history = [
      fundingItem,
      historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { amount: 1000n }), opReturnOutput(publicationHex)]),
    ]
    const fetcher = rawTransactionsFetcher({ [spenderTxid]: rawTransactionSpending([{ txid: genesisInputTxid, vout: 1 }]) })

    expect((await detectIdentities(history, fetcher)).identities).toEqual([
      { authheadTxid: spenderTxid, category: genesisInputTxid, marker: 'publication' },
    ])
  })
})
