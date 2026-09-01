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
    expect(described[0]?.reserve).toBe(1000n)
  })

  // the reserve read down the list is the issuance schedule, which is bookkeeping for an issuer
  it('reads an issuance out of the reserve going down', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: '1000' }),
      link('bb'.repeat(32), { reserve: '900' }),
    ])

    expect(described[1]?.kind).toBe('issue')
    expect(described[1]?.reserveDelta).toBe(-100n)
  })

  it('reads supply put back out of the reserve going up', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: '900' }),
      link('bb'.repeat(32), { reserve: '1000' }),
    ])

    expect(described[1]?.kind).toBe('addToReserve')
    expect(described[1]?.reserveDelta).toBe(100n)
  })

  // emptying leaves nothing on the identity output, which is a different thing from issuing some
  it('tells an emptied reserve from an issuance', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: '1000' }),
      link('bb'.repeat(32), { reserve: null }),
    ])

    expect(described[1]?.kind).toBe('emptyReserve')
    expect(described[1]?.reserve).toBe(0n)
  })

  it('reads a publication off the BCMR output, and keeps what it published', () => {
    const described = describeChainLinks([
      link('aa'.repeat(32), { reserve: '1000' }),
      link('bb'.repeat(32), { reserve: '1000' }, publicationOutput),
    ])

    expect(described[1]?.kind).toBe('publication')
    expect(described[1]?.publication?.uris).toEqual(['example.com'])
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
