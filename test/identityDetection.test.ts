import { describe, expect, it } from 'vitest'
import { detectIdentities } from '../src/utils/tools/identityDetection'
import { historyItem, opReturnOutput, p2pkhOutput, tokenOutput, spendOf } from './mocks/history.mocks'

const genesisInputTxid = 'aa'.repeat(32)
const spenderTxid = 'bb'.repeat(32)
const otherCategory = 'cc'.repeat(32)
// OP_RETURN, a push of "BCMR", then the hash and locations
const publicationHex = `6a0442434d5220${'11'.repeat(32)}0b6578616d706c652e636f6d`

// the outpoint transaction is in the history, as any transaction paying the wallet is
const fundingItem = historyItem(genesisInputTxid, [p2pkhOutput(), p2pkhOutput()])

describe('detectIdentities', () => {
  // a genesis names its own authbase: the category is the outpoint it consumed
  it('finds a token these keys genesised', () => {
    const history = [
      fundingItem,
      historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })], [spendOf(genesisInputTxid, 0)]),
    ]

    expect(detectIdentities(history).identities).toEqual([
      { authheadTxid: spenderTxid, category: genesisInputTxid, marker: 'genesis' },
    ])
  })

  // only a vout-0 outpoint can be a genesis input; a token whose category is a transaction of
  // this history but that spent a later output of it is a token sent onward
  it('does not read a genesis off a spend of a later output', () => {
    const history = [
      fundingItem,
      historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })], [spendOf(genesisInputTxid, 1)]),
    ]

    expect(detectIdentities(history).identities).toEqual([])
  })

  // a token sent onward is not a token created: the category is somebody else's outpoint
  it('does not read a genesis off an ordinary token send', () => {
    const history = [
      fundingItem,
      historyItem(spenderTxid, [tokenOutput(otherCategory, { amount: 1000n })]),
    ]

    expect(detectIdentities(history).identities).toEqual([])
  })

  it('finds a metadata publication these keys made, named by its identity output', () => {
    const history = [historyItem(spenderTxid, [
      tokenOutput(otherCategory, { amount: 500n }),
      p2pkhOutput(),
      opReturnOutput(publicationHex),
    ])]

    const detected = detectIdentities(history)

    expect(detected.identities).toEqual([
      { authheadTxid: spenderTxid, category: otherCategory, marker: 'publication', publicationOutputs: [publicationHex] },
    ])
    expect(detected.publicationTxids).toEqual([spenderTxid])
  })

  // a BCH-only chain has nothing on its identity output to name it; it is protected first and
  // named afterwards from the registry its publication points at
  it('finds a publication on a BCH-only chain, unnamed', () => {
    const history = [historyItem(spenderTxid, [p2pkhOutput(), opReturnOutput(publicationHex)])]

    expect(detectIdentities(history).identities).toEqual([
      { authheadTxid: spenderTxid, marker: 'publication', publicationOutputs: [publicationHex] },
    ])
  })

  it('ignores a transaction that is neither', () => {
    const history = [historyItem(spenderTxid, [p2pkhOutput(), p2pkhOutput()])]

    expect(detectIdentities(history).identities).toEqual([])
  })

  // the genesis marker is the more informative one, so it is not overwritten by the other
  it('prefers the genesis reading when a transaction is both', () => {
    const history = [
      fundingItem,
      historyItem(
        spenderTxid,
        [tokenOutput(genesisInputTxid, { amount: 1000n }), opReturnOutput(publicationHex)],
        [spendOf(genesisInputTxid, 0)],
      ),
    ]

    const detected = detectIdentities(history)

    expect(detected.identities[0]?.marker).toBe('genesis')
    expect(detected.publicationTxids).toEqual([spenderTxid])
  })

  // a candidate that turns out to be a token sent onward keeps its publication reading
  it('keeps the publication reading of a candidate that was no genesis', () => {
    const history = [
      fundingItem,
      historyItem(
        spenderTxid,
        [tokenOutput(genesisInputTxid, { amount: 1000n }), opReturnOutput(publicationHex)],
        [spendOf(genesisInputTxid, 1)],
      ),
    ]

    expect(detectIdentities(history).identities).toEqual([
      { authheadTxid: spenderTxid, category: genesisInputTxid, marker: 'publication', publicationOutputs: [publicationHex] },
    ])
  })

  // The marker fires on the link that carries it, and a chain moves on: the wallet holds the
  // authhead, not the genesis, so the walk down the output-0 spends is what makes it a match.
  it('walks a genesis forward to the authhead this history ends at', () => {
    const mintTxid = 'dd'.repeat(32)
    const transferTxid = 'ee'.repeat(32)
    const history = [
      fundingItem,
      historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { commitment: '' })], [spendOf(genesisInputTxid, 0)]),
      historyItem(
        mintTxid,
        [tokenOutput(genesisInputTxid, { commitment: '' }), tokenOutput(genesisInputTxid, { commitment: '00' })],
        [spendOf(spenderTxid, 0), spendOf(otherCategory, 1)],
      ),
      historyItem(transferTxid, [tokenOutput(genesisInputTxid, { commitment: '' })], [spendOf(mintTxid, 0)]),
    ]

    expect(detectIdentities(history).identities).toEqual([
      { authheadTxid: transferTxid, category: genesisInputTxid, marker: 'genesis' },
    ])
  })

  // an identity received from elsewhere and published here, then moved on without publishing
  it('walks a publication forward to the authhead this history ends at', () => {
    const transferTxid = 'ee'.repeat(32)
    const history = [
      historyItem(spenderTxid, [tokenOutput(otherCategory, { amount: 500n }), opReturnOutput(publicationHex)]),
      historyItem(transferTxid, [tokenOutput(otherCategory, { amount: 500n })], [spendOf(spenderTxid, 0)]),
    ]

    expect(detectIdentities(history).identities).toEqual([
      { authheadTxid: transferTxid, category: otherCategory, marker: 'publication', publicationOutputs: [publicationHex] },
    ])
  })

  // the genesis and the publication after it are two markers on one chain, which walk to one coin
  it('collapses the markers of one chain onto its authhead', () => {
    const publishTxid = 'dd'.repeat(32)
    const history = [
      fundingItem,
      historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })], [spendOf(genesisInputTxid, 0)]),
      historyItem(
        publishTxid,
        [tokenOutput(genesisInputTxid, { amount: 1000n }), opReturnOutput(publicationHex)],
        [spendOf(spenderTxid, 0)],
      ),
    ]

    const detected = detectIdentities(history)

    expect(detected.identities).toEqual([
      { authheadTxid: publishTxid, category: genesisInputTxid, marker: 'genesis' },
    ])
    expect(detected.publicationTxids).toEqual([publishTxid])
  })

  // Splitting the tokens off an identity, or emptying its reserve, leaves the chain continuing on
  // a plain BCH output. The identity is no less the identity for it, so the walk must not stop at
  // the last link that happened to carry a token.
  it('follows a chain through links that carry no token', () => {
    const emptyReserveTxid = 'dd'.repeat(32)
    const moveTxid = 'ee'.repeat(32)
    const history = [
      fundingItem,
      historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })], [spendOf(genesisInputTxid, 0)]),
      historyItem(
        emptyReserveTxid,
        [p2pkhOutput(), tokenOutput(genesisInputTxid, { amount: 1000n })],
        [spendOf(spenderTxid, 0)],
      ),
      historyItem(moveTxid, [p2pkhOutput()], [spendOf(emptyReserveTxid, 0)]),
    ]

    expect(detectIdentities(history).identities).toEqual([
      { authheadTxid: moveTxid, category: genesisInputTxid, marker: 'genesis' },
    ])
  })

  // The outpoints come from a patched mainnet-js. Were the patch ever dropped they would simply be
  // absent, and the detection degrades to the marker's own transaction rather than throwing.
  it('stops the walk at the last link whose outpoints it can read', () => {
    const mintTxid = 'dd'.repeat(32)
    const history = [
      fundingItem,
      historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })], [spendOf(genesisInputTxid, 0)]),
      historyItem(mintTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })], [p2pkhOutput()]),
    ]

    expect(detectIdentities(history).identities).toEqual([
      { authheadTxid: spenderTxid, category: genesisInputTxid, marker: 'genesis' },
    ])
  })
})
