import { describe, expect, it } from 'vitest'
import type { ChaingraphSpentOutput } from '../src/queryChainGraph'
import { detectIdentities, nameChainByWalkingBack } from '../src/utils/tools/identityDetection'

const bytea = (hex: string) => `\\x${hex}`
const genesisInputTxid = 'aa'.repeat(32)
const spenderTxid = 'bb'.repeat(32)
const otherCategory = 'cc'.repeat(32)
// OP_RETURN, a push of "BCMR", then the hash and locations
const publicationBytecode = `6a0442434d5220${'11'.repeat(32)}0b6578616d706c652e636f6d`

type Output = ChaingraphSpentOutput['spent_by'][number]['transaction']['outputs'][number]

const output = (index: number, fields: Partial<Output> = {}): Output => ({
  output_index: String(index),
  locking_bytecode: bytea('76a914' + '00'.repeat(20) + '88ac'),
  token_category: null,
  nonfungible_token_commitment: null,
  fungible_token_amount: null,
  spent_by: [],
  ...fields,
})

const walkRow = (
  spent: { txid: string, vout: number },
  spenderHash: string,
  outputs: Output[],
): ChaingraphSpentOutput => ({
  transaction_hash: bytea(spent.txid),
  output_index: String(spent.vout),
  spent_by: [{ transaction: { hash: bytea(spenderHash), outputs } }],
})

describe('detectIdentities', () => {
  // a genesis names its own authbase: the category is the outpoint it consumed
  it('finds a token these keys genesised', () => {
    const rows = [walkRow({ txid: genesisInputTxid, vout: 0 }, spenderTxid, [
      output(0, { token_category: bytea(genesisInputTxid), fungible_token_amount: '1000' }),
    ])]

    expect(detectIdentities(rows).identities).toEqual([
      { authheadTxid: spenderTxid, category: genesisInputTxid, marker: 'genesis' },
    ])
  })

  // only a vout-0 outpoint can be a genesis input, which is what keeps the marker local
  it('does not read a genesis off a spend of a later output', () => {
    const rows = [walkRow({ txid: genesisInputTxid, vout: 1 }, spenderTxid, [
      output(0, { token_category: bytea(genesisInputTxid), fungible_token_amount: '1000' }),
    ])]

    expect(detectIdentities(rows).identities).toEqual([])
  })

  // a token sent onward is not a token created: the category is somebody else's outpoint
  it('does not read a genesis off an ordinary token send', () => {
    const rows = [walkRow({ txid: genesisInputTxid, vout: 0 }, spenderTxid, [
      output(0, { token_category: bytea(otherCategory), fungible_token_amount: '1000' }),
    ])]

    expect(detectIdentities(rows).identities).toEqual([])
  })

  it('finds a metadata publication these keys made, named by its identity output', () => {
    const rows = [walkRow({ txid: genesisInputTxid, vout: 1 }, spenderTxid, [
      output(0, { token_category: bytea(otherCategory), fungible_token_amount: '500' }),
      output(2, { locking_bytecode: bytea(publicationBytecode) }),
    ])]

    expect(detectIdentities(rows).identities).toEqual([
      { authheadTxid: spenderTxid, category: otherCategory, marker: 'publication' },
    ])
  })

  // a BCH-only chain has nothing on its identity output to name it; it is protected first and
  // named afterwards by walking back to its genesis
  it('finds a publication on a BCH-only chain, unnamed', () => {
    const rows = [walkRow({ txid: genesisInputTxid, vout: 1 }, spenderTxid, [
      output(0),
      output(1, { locking_bytecode: bytea(publicationBytecode) }),
    ])]

    expect(detectIdentities(rows).identities).toEqual([
      { authheadTxid: spenderTxid, marker: 'publication' },
    ])
  })

  it('ignores a transaction that is neither', () => {
    const rows = [walkRow({ txid: genesisInputTxid, vout: 1 }, spenderTxid, [output(0), output(1)])]

    expect(detectIdentities(rows).identities).toEqual([])
  })

  // the walk lists a transaction once per wallet output it spent, and it is one identity
  it('reports a transaction once however many wallet outputs it spent', () => {
    const rows = [
      walkRow({ txid: genesisInputTxid, vout: 1 }, spenderTxid, [
        output(0, { token_category: bytea(otherCategory) }),
        output(2, { locking_bytecode: bytea(publicationBytecode) }),
      ]),
      walkRow({ txid: otherCategory, vout: 3 }, spenderTxid, [
        output(0, { token_category: bytea(otherCategory) }),
        output(2, { locking_bytecode: bytea(publicationBytecode) }),
      ]),
    ]

    expect(detectIdentities(rows).identities).toHaveLength(1)
  })

  // the genesis marker is the more informative one, so it is not overwritten by the other
  it('prefers the genesis reading when a transaction is both', () => {
    const rows = [walkRow({ txid: genesisInputTxid, vout: 0 }, spenderTxid, [
      output(0, { token_category: bytea(genesisInputTxid), fungible_token_amount: '1000' }),
      output(1, { locking_bytecode: bytea(publicationBytecode) }),
    ])]

    expect(detectIdentities(rows).identities[0]?.marker).toBe('genesis')
  })
})

// A chain, youngest first: each link spends its parent's output 0, and the genesis mints the
// category named by the outpoint it spent.
function chainFetcher(links: { txid: string, parent: string, mints?: string }[]) {
  const calls: string[] = []
  const fetchTransaction = (txid: string) => {
    calls.push(txid)
    const link = links.find(entry => entry.txid === txid)
    if (!link) return Promise.reject(new Error('unknown transaction'))
    return Promise.resolve({
      vin: [{ txid: link.parent, vout: 0 }],
      vout: [{ n: 0, ...(link.mints ? { tokenData: { category: link.mints } } : {}) }],
    })
  }
  return { fetchTransaction, calls }
}

describe('nameChainByWalkingBack', () => {
  const authhead = 'dd'.repeat(32)
  const middle = 'ee'.repeat(32)
  const genesis = 'ff'.repeat(32)
  const genesisInput = '99'.repeat(32)

  // the genesis is a definition, not an index's opinion: it mints the category of what it spent
  it('walks back to the genesis and names the category', async () => {
    const { fetchTransaction } = chainFetcher([
      { txid: authhead, parent: middle },
      { txid: middle, parent: genesis },
      { txid: genesis, parent: genesisInput, mints: genesisInput },
    ])

    expect(await nameChainByWalkingBack(authhead, fetchTransaction))
      .toBe(genesisInput)
  })

  // every link is this chain's, so a token on its output 0 is the identity's own category: an NFT
  // collection minted from its identity UTXO has one link per mint, which a walk to the genesis
  // would spend the hop limit on
  it('names the chain from the first link whose output 0 carries the category', async () => {
    const category = '77'.repeat(32)
    const { fetchTransaction, calls } = chainFetcher([
      { txid: authhead, parent: middle },
      { txid: middle, parent: genesis, mints: category },
      { txid: genesis, parent: genesisInput, mints: genesisInput },
    ])

    expect(await nameChainByWalkingBack(authhead, fetchTransaction)).toBe(category)
    expect(calls).toEqual([authhead, middle])
  })

  it('stops at the genesis rather than walking past it', async () => {
    const { fetchTransaction, calls } = chainFetcher([
      { txid: authhead, parent: genesis },
      { txid: genesis, parent: genesisInput, mints: genesisInput },
    ])

    await nameChainByWalkingBack(authhead, fetchTransaction)

    expect(calls).toEqual([authhead, genesis])
  })

  // an unusual chain must not cost an unbounded number of fetches
  it('gives up at the hop limit, leaving the identity unnamed', async () => {
    const links = Array.from({ length: 10 }, (_, index) => ({
      txid: String(index).padStart(64, '0'),
      parent: String(index + 1).padStart(64, '0'),
    }))
    const { fetchTransaction, calls } = chainFetcher(links)

    // a conclusion: walked as far as it is worth walking, so this one is worth remembering
    expect(await nameChainByWalkingBack(links[0]!.txid, fetchTransaction, 4))
      .toBeUndefined()
    expect(calls).toHaveLength(4)
  })

  // an unfetchable hop says nothing about the chain, so it must not be remembered as a conclusion:
  // one network failure would otherwise give up on naming it forever
  it('gives up on an unfetchable hop, to be walked again next session', async () => {
    const { fetchTransaction } = chainFetcher([{ txid: authhead, parent: middle }])

    expect(await nameChainByWalkingBack(authhead, fetchTransaction))
      .toBeUndefined()
  })

  // a transaction spending no vout-0 outpoint is not an authchain link
  it('gives up where the chain does not continue', async () => {
    const fetchTransaction = () => Promise.resolve({ vin: [{ txid: middle, vout: 2 }], vout: [] })

    expect(await nameChainByWalkingBack(authhead, fetchTransaction))
      .toBeUndefined()
  })
})
