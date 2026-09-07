import { describe, expect, it } from 'vitest'
import type { ChaingraphSpentOutput } from '../src/queryChainGraph'
import { detectIdentities } from '../src/utils/tools/identityDetection'

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
  // named afterwards from the registry its publication points at
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
