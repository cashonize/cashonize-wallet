import { describe, expect, it } from 'vitest'
import type { AuthchainLink } from '../src/queryChainGraph'
import { describeChainLinks } from '../src/utils/tools/authchainIdentity'

const category = 'aa'.repeat(32)
const ownerLock = '\\x76a914' + '11'.repeat(20) + '88ac'
const newOwnerLock = '\\x76a914' + '22'.repeat(20) + '88ac'
const publicationBytecode = '\\x6a0442434d5220' + '33'.repeat(32) + '0b6578616d706c652e636f6d'

const link = (
  hash: string,
  identity: { reserve?: string | null, lock?: string } = {},
  extraOutputs: AuthchainLink['outputs'] = [],
): AuthchainLink => ({
  hash,
  outputs: [
    {
      output_index: '0',
      locking_bytecode: identity.lock ?? ownerLock,
      token_category: `\\x${category}`,
      fungible_token_amount: identity.reserve ?? null,
    },
    ...extraOutputs,
  ],
})

const publicationOutput: AuthchainLink['outputs'] = [{
  output_index: '2',
  locking_bytecode: publicationBytecode,
  token_category: null,
  fungible_token_amount: null,
}]

describe('describeChainLinks', () => {
  // the first link is the transaction the id is named by; the category is minted by the next one
  it('calls the first link the authbase and the link minting its category the genesis', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: null }),
      link('bb'.repeat(32), { reserve: '1000' }),
    ])

    expect(described.map(link => link.kind)).toEqual(['authbase', 'genesis'])
    expect(described[1]?.reserveDelta).toBe(1000n)
  })

  // an identity that is not a token: nothing minted, so the second link is an ordinary operation
  it('calls no link the genesis when none mints the category', () => {
    const otherCategory = 'ee'.repeat(32)
    const described = describeChainLinks([
      link(otherCategory, { reserve: null }),
      link('bb'.repeat(32), { reserve: null }),
    ])

    expect(described.map(link => link.kind)).toEqual(['authbase', 'operation'])
  })

  // an identity output nothing can spend ends the chain, whatever else the link did
  it('marks a link whose identity output is an OP_RETURN as the burn, on top of its kind', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: null }),
      link('bb'.repeat(32), { reserve: '1000' }),
      link('cc'.repeat(32), { reserve: null, lock: '\\x6a' }),
    ])

    expect(described.map(link => link.burned)).toEqual([false, false, true])
    expect(described[2]?.kind).toBe('operation')
  })

  // a token minted with its identity burned at once, which is how an immutable token is made
  it('keeps a genesis that burned the identity the genesis, marked burned', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: null }),
      link('bb'.repeat(32), { reserve: '1000', lock: '\\x6a' }),
    ])

    expect(described[1]).toMatchObject({ kind: 'genesis', burned: true })
  })

  // the reserve read down the list is the issuance schedule, which is bookkeeping for an issuer
  it('reads how much supply moved out of the reserve before and after', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: '1000' }),
      link('bb'.repeat(32), { reserve: '900' }),
      link('cc'.repeat(32), { reserve: null }),
      link('dd'.repeat(32), { reserve: '1000' }),
    ])

    expect(described.slice(1).map(link => link.kind)).toEqual(['genesis', 'operation', 'operation'])
    expect(described.slice(1).map(link => link.reserveDelta)).toEqual([-100n, -900n, 1000n])
  })

  it('reads a publication off the BCMR output, and keeps what it published', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: null }),
      link('bb'.repeat(32), { reserve: '1000' }),
      link('cc'.repeat(32), { reserve: '1000' }, publicationOutput),
    ])

    expect(described[2]?.kind).toBe('publication')
    expect(described[2]?.publication?.uris).toEqual(['example.com'])
  })

  // a genesis usually publishes in the same transaction: it stays the genesis, and keeps the publication
  it('keeps a genesis that also published the genesis, with what it published', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: null }),
      link('bb'.repeat(32), { reserve: '1000' }, publicationOutput),
    ])

    expect(described[1]?.kind).toBe('genesis')
    expect(described[1]?.publication?.uris).toEqual(['example.com'])
  })

  // NFTs of the category beside an unchanged identity output are a mint; a reserve move also puts
  // category outputs beside it, and is told apart by the reserve going down
  it('reads a mint off NFTs of the category minted beside the identity output', () => {
    const mintedNft: AuthchainLink['outputs'][number] = {
      output_index: '1', locking_bytecode: ownerLock, token_category: `\\x${category}`, fungible_token_amount: null,
    }
    const described = describeChainLinks([
      link('a'.repeat(64), { reserve: null }),
      link('b'.repeat(64), { reserve: '500' }),
      link('c'.repeat(64), { reserve: '500' }, [mintedNft, { ...mintedNft, output_index: '2' }]),
      link('d'.repeat(64), { reserve: '400' }, [mintedNft]),
    ])
    expect(described[2]).toMatchObject({ kind: 'mint', minted: 2, reserveDelta: 0n })
    expect(described[3]?.kind).toBe('operation')
  })

  // the identity output moving to another lock, with the reserve untouched, is a handover
  it('reads a transfer off the identity output changing hands', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: null }),
      link('bb'.repeat(32), { reserve: '1000' }),
      link('cc'.repeat(32), { reserve: '1000', lock: newOwnerLock }),
    ])

    expect(described[2]?.kind).toBe('transfer')
  })

  it('says nothing more than operation about a link it cannot read', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: null }),
      link('bb'.repeat(32), { reserve: '1000' }),
      link('cc'.repeat(32), { reserve: '1000' }),
    ])

    expect(described[2]?.kind).toBe('operation')
  })
})
