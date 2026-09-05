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
  it('calls the first link the genesis', () => {
    const described = describeChainLinks([link('aa'.repeat(32), { reserve: '1000' })])

    expect(described[0]?.kind).toBe('genesis')
  })

  // the reserve read down the list is the issuance schedule, which is bookkeeping for an issuer
  it('reads how much supply moved out of the reserve before and after', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: '1000' }),
      link('bb'.repeat(32), { reserve: '900' }),
      link('cc'.repeat(32), { reserve: null }),
      link('dd'.repeat(32), { reserve: '1000' }),
    ])

    expect(described.slice(1).map(link => link.kind)).toEqual(['operation', 'operation', 'operation'])
    expect(described.slice(1).map(link => link.reserveDelta)).toEqual([-100n, -900n, 1000n])
  })

  it('reads a publication off the BCMR output, and keeps what it published', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: '1000' }),
      link('bb'.repeat(32), { reserve: '1000' }, publicationOutput),
    ])

    expect(described[1]?.kind).toBe('publication')
    expect(described[1]?.publication?.uris).toEqual(['example.com'])
  })

  // NFTs of the category beside an unchanged identity output are a mint; a reserve move also puts
  // category outputs beside it, and is told apart by the reserve going down
  it('reads a mint off NFTs of the category minted beside the identity output', () => {
    const mintedNft: AuthchainLink['outputs'][number] = {
      output_index: '1', locking_bytecode: ownerLock, token_category: `\\x${category}`, fungible_token_amount: null,
    }
    const described = describeChainLinks([
      link('a'.repeat(64), { reserve: '500' }),
      link('b'.repeat(64), { reserve: '500' }, [mintedNft, { ...mintedNft, output_index: '2' }]),
      link('c'.repeat(64), { reserve: '400' }, [mintedNft]),
    ])
    expect(described[1]).toMatchObject({ kind: 'mint', minted: 2, reserveDelta: 0n })
    expect(described[2]?.kind).toBe('operation')
  })

  // the identity output moving to another lock, with the reserve untouched, is a handover
  it('reads a transfer off the identity output changing hands', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: '1000' }),
      link('bb'.repeat(32), { reserve: '1000', lock: newOwnerLock }),
    ])

    expect(described[1]?.kind).toBe('transfer')
  })

  it('says nothing more than operation about a link it cannot read', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: '1000' }),
      link('bb'.repeat(32), { reserve: '1000' }),
    ])

    expect(described[1]?.kind).toBe('operation')
  })
})
