import { describe, expect, it } from 'vitest'
import type { InOutput } from 'mainnet-js'
import { contractStateIdentities, detectIdentities } from '../src/utils/tools/identityDetection'
import { authGuardLockingBytecodes } from '../src/utils/tools/authGuard'
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

  describe('through contracts', () => {
    const at = (inOutput: InOutput, lockingBytecode: string): InOutput => ({ ...inOutput, lockingBytecode })
    const p2shContract = `aa20${'03'.repeat(32)}87`
    // P2S: the bytecode itself locks the coin (OP_1 OP_ADD OP_2 OP_EQUAL), with no address form
    const p2sContract = '51935287'
    const otherWallet = `76a914${'02'.repeat(20)}88ac`
    const keyCategory = 'ab'.repeat(32)
    const guard = authGuardLockingBytecodes(keyCategory).p2sh32
    const authKeyInput = (category = keyCategory): InOutput => ({
      ...spendOf('ad'.repeat(32), 1),
      token: { category, amount: 0n, nft: { capability: 'none', commitment: '00' } },
    })
    const stakeInput = (contract: string): InOutput =>
      ({ ...at(spendOf(otherCategory, 2), contract), token: { category: otherCategory, amount: 344n } })
    const payoutTxid = 'dd'.repeat(32)
    const releaseTxid = 'ee'.repeat(32)

    // A dapp has the user sign a genesis minting its ticket straight into its covenant, and the
    // contract settles by spending that output 0 and paying the user at output 0. By the spec the
    // payout is the authhead of a token these keys created; it is the contract's, not held back.
    const contractHistory = (contract: string, payout: InOutput = p2pkhOutput()) => [
      fundingItem,
      historyItem(spenderTxid, [at(tokenOutput(genesisInputTxid, { commitment: '' }), contract)], [spendOf(genesisInputTxid, 0)]),
      historyItem(payoutTxid, [payout], [at(spendOf(spenderTxid, 0), contract), stakeInput(contract)]),
    ]

    it.each([['P2SH', p2shContract], ['P2S', p2sContract]])('stops where the chain enters a %s contract', (_, contract) => {
      expect(detectIdentities(contractHistory(contract)).identities).toEqual([
        { authheadTxid: spenderTxid, category: genesisInputTxid, marker: 'genesis' },
      ])
    })

    // the create page promises the identity can move into CashTokens Studio and back
    it('follows the chain through an AuthGuard and back out to this wallet', () => {
      const guardTxid = 'cd'.repeat(32)
      const history = [
        fundingItem,
        historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })], [spendOf(genesisInputTxid, 0)]),
        historyItem(guardTxid, [at(tokenOutput(genesisInputTxid, { amount: 1000n }), guard)], [spendOf(spenderTxid, 0)]),
        historyItem(releaseTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })], [at(spendOf(guardTxid, 0), guard), authKeyInput()]),
      ]

      expect(detectIdentities(history).identities).toEqual([
        { authheadTxid: releaseTxid, category: genesisInputTxid, marker: 'genesis' },
      ])
    })

    // a Studio genesis is signed here and mints into the guard, then is updated inside it before
    // its release: every guard link brings the key in from this wallet, so all are in the history
    it('follows a genesis made into an AuthGuard through its updates to the release', () => {
      const updateTxid = 'cd'.repeat(32)
      const history = [
        fundingItem,
        historyItem(spenderTxid, [at(tokenOutput(genesisInputTxid, { amount: 1000n }), guard)], [spendOf(genesisInputTxid, 0)]),
        historyItem(
          updateTxid,
          [at(tokenOutput(genesisInputTxid, { amount: 1000n }), guard), opReturnOutput(publicationHex)],
          [at(spendOf(spenderTxid, 0), guard), authKeyInput()],
        ),
        historyItem(releaseTxid, [p2pkhOutput()], [at(spendOf(updateTxid, 0), guard), authKeyInput()]),
      ]

      expect(detectIdentities(history).identities).toEqual([
        { authheadTxid: releaseTxid, category: genesisInputTxid, marker: 'genesis' },
      ])
    })

    // a token at input 1 proves nothing unless its category derives this very covenant
    it('does not take a contract for an AuthGuard on a key that does not open it', () => {
      const history = [
        fundingItem,
        historyItem(spenderTxid, [at(tokenOutput(genesisInputTxid, { amount: 1000n }), guard)], [spendOf(genesisInputTxid, 0)]),
        historyItem(releaseTxid, [p2pkhOutput()], [at(spendOf(spenderTxid, 0), guard), authKeyInput('ef'.repeat(32))]),
      ]

      expect(detectIdentities(history).identities).toEqual([
        { authheadTxid: spenderTxid, category: genesisInputTxid, marker: 'genesis' },
      ])
    })

    // between key-held outputs there is no contract to doubt: sent away and back is still found
    it('follows the chain to another wallet and back', () => {
      const awayTxid = 'cd'.repeat(32)
      const history = [
        fundingItem,
        historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })], [spendOf(genesisInputTxid, 0)]),
        historyItem(awayTxid, [at(tokenOutput(genesisInputTxid, { amount: 1000n }), otherWallet)], [spendOf(spenderTxid, 0)]),
        historyItem(releaseTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })], [at(spendOf(awayTxid, 0), otherWallet)]),
      ]

      expect(detectIdentities(history).identities).toEqual([
        { authheadTxid: releaseTxid, category: genesisInputTxid, marker: 'genesis' },
      ])
    })

    // what v0.14.1 held back before the walk stopped at contracts
    describe('contractStateIdentities', () => {
      const heldPayout = [{ category: genesisInputTxid, authheadTxid: payoutTxid }]

      it.each([
        ['BCH', p2pkhOutput()],
        ['a token', tokenOutput(otherCategory, { amount: 341n })],
      ])('releases a payout in %s', (_, payout) => {
        expect(contractStateIdentities(contractHistory(p2shContract, payout), heldPayout)).toEqual([genesisInputTxid])
      })

      it('keeps an identity the walk still reaches', () => {
        const history = [
          fundingItem,
          historyItem(spenderTxid, [tokenOutput(genesisInputTxid, { amount: 1000n })], [spendOf(genesisInputTxid, 0)]),
        ]

        expect(contractStateIdentities(history, [{ category: genesisInputTxid, authheadTxid: spenderTxid }])).toEqual([])
      })

      // the walk stopping for want of the next link is a gap in the history, not a contract
      it('keeps an identity whose chain leaves the history at a contract', () => {
        expect(contractStateIdentities(contractHistory(p2shContract).slice(0, 2), heldPayout)).toEqual([])
      })

      it('keeps an identity whose genesis is not in this history', () => {
        const history = contractHistory(p2shContract).filter(item => item.hash !== spenderTxid)

        expect(contractStateIdentities(history, heldPayout)).toEqual([])
      })

      // A creator who minted their supply to themselves and parked the identity in a multisig
      // before taking it back: the genesis credited this wallet, as mainnet-js reports it
      it('keeps an identity whose tokens the genesis gave this wallet', () => {
        const history = [
          fundingItem,
          {
            ...historyItem(
              spenderTxid,
              [at(tokenOutput(genesisInputTxid, { commitment: '' }), p2shContract), tokenOutput(genesisInputTxid, { amount: 1000n })],
              [spendOf(genesisInputTxid, 0)],
            ),
            tokenAmountChanges: [{ category: genesisInputTxid, amount: 1000n, nftAmount: 0n }],
          },
          historyItem(payoutTxid, [p2pkhOutput()], [at(spendOf(spenderTxid, 0), p2shContract)]),
        ]

        expect(contractStateIdentities(history, heldPayout)).toEqual([])
      })

      // the ticket shape is the contract holding the category's own NFT; BCH parked in a contract
      // and brought back is not that, whatever else it is
      it('keeps an identity whose contract output carries no NFT of its own', () => {
        const history = [
          fundingItem,
          historyItem(
            spenderTxid,
            [at(p2pkhOutput(), p2shContract), at(tokenOutput(genesisInputTxid, { amount: 1000n }), otherWallet)],
            [spendOf(genesisInputTxid, 0)],
          ),
          historyItem(payoutTxid, [p2pkhOutput()], [at(spendOf(spenderTxid, 0), p2shContract)]),
        ]

        expect(contractStateIdentities(history, heldPayout)).toEqual([])
      })
    })
  })
})
