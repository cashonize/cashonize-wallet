import { describe, expect, it } from 'vitest'
import { TokenSendRequest } from 'mainnet-js'
import type { Utxo } from 'mainnet-js'
import { binToHex } from '@bitauth/libauth'

import {
  diffRegistries,
  identityOutput,
  maxPublicationOutputSize,
  parsePublicationOutput,
  publicationOutput,
  publicationOutputSize,
  summarizeRegistry,
} from '../src/utils/tools/authchainIdentity'

const category = '0123456789abcdef'.repeat(4)
const hash = 'ab'.repeat(32)
const addresses = { bch: 'bitcoincash:qtest', token: 'bitcoincash:ztest' }

const authUtxo = (token?: Utxo['token']): Utxo =>
  ({ txid: 'aa'.repeat(32), vout: 0, satoshis: 1000n, address: addresses.bch, ...(token ? { token } : {}) })

describe('identityOutput', () => {
  // spending the old authhead as input 0 and recreating it here is what continues the authchain
  it('recreates a BCH-only authhead with the value it had', () => {
    expect(identityOutput(authUtxo(), addresses)).toEqual({ cashaddr: addresses.bch, value: 1000n })
  })

  it('carries the reserve and the NFT of a token authhead over untouched', () => {
    const output = identityOutput(
      authUtxo({ category, amount: 500n, nft: { commitment: 'aa', capability: 'minting' } }),
      addresses,
    ) as TokenSendRequest

    expect(output).toBeInstanceOf(TokenSendRequest)
    expect(output.amount).toBe(500n)
    expect(output.nft).toEqual({ commitment: 'aa', capability: 'minting' })
    expect(output.value).toBe(1000n)
  })

  it('takes the reserve an operation leaves behind', () => {
    const output = identityOutput(authUtxo({ category, amount: 500n }), addresses, 300n) as TokenSendRequest

    expect(output.amount).toBe(300n)
  })

  // a token output of amount zero is only valid while it carries an NFT
  it('becomes a plain BCH output once the reserve is emptied', () => {
    expect(identityOutput(authUtxo({ category, amount: 500n }), addresses, 0n))
      .toEqual({ cashaddr: addresses.bch, value: 1000n })
  })

  it('stays a token output for an emptied reserve that still carries an NFT', () => {
    const output = identityOutput(
      authUtxo({ category, amount: 500n, nft: { commitment: '', capability: 'minting' } }),
      addresses,
      0n,
    ) as TokenSendRequest

    expect(output).toBeInstanceOf(TokenSendRequest)
    expect(output.amount).toBe(0n)
  })
})

describe('publicationOutput', () => {
  // what the wallet writes is what it reads back off the chain
  it('round-trips through the parser', () => {
    const uris = ['ipfs://bafyexamplecid', 'example.com']
    const encoded = binToHex(publicationOutput(hash, uris).buffer)

    expect(parsePublicationOutput(encoded)).toEqual({ hash, uris })
  })

  it('accounts for its own size', () => {
    const uris = ['ipfs://bafyexamplecid', 'example.com']

    expect(publicationOutputSize(uris)).toBe(publicationOutput(hash, uris).buffer.length)
  })

  // the locations are capped by the data carrier limit rather than by the form
  it('counts a long location out of the budget', () => {
    const tooMany = Array.from({ length: 6 }, (_, index) => `mirror${index}.example.com/registry.json`)

    expect(publicationOutputSize(tooMany)).toBeGreaterThan(maxPublicationOutputSize)
  })
})

const registryWith = (snapshots: Record<string, unknown>) => JSON.stringify({
  version: { major: 1, minor: 0, patch: 0 },
  latestRevision: '2024-01-01T00:00:00.000Z',
  registryIdentity: { name: 'Test registry' },
  identities: { [category]: snapshots },
})

const snapshot = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, token: { category, symbol: 'TEST', decimals: 2 }, ...extra })

describe('summarizeRegistry', () => {
  it('reads the latest snapshot of this identity', () => {
    const summary = summarizeRegistry(registryWith({
      '2024-01-01T00:00:00.000Z': snapshot('Old name'),
      '2025-01-01T00:00:00.000Z': snapshot('New name', { uris: { icon: 'ipfs://icon' } }),
    }), category)

    expect(summary).toEqual({
      name: 'New name',
      symbol: 'TEST',
      decimals: 2,
      iconUri: 'ipfs://icon',
      snapshots: ['2024-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'],
    })
  })

  // the wrong-file mistake, which is cheapest to catch before signing anything
  it('reports a registry that names no identity for this authbase', () => {
    const otherRegistry = registryWith({}).replace(category, 'ff'.repeat(32))

    expect(summarizeRegistry(otherRegistry, category)).toBeUndefined()
  })

  it('reports a file that is not a registry', () => {
    expect(summarizeRegistry('not json at all', category)).toBeUndefined()
  })
})

describe('diffRegistries', () => {
  it('names what holders will see change', () => {
    const current = summarizeRegistry(registryWith({ '2024-01-01T00:00:00.000Z': snapshot('Old name') }), category)!
    const candidate = summarizeRegistry(registryWith({
      '2024-01-01T00:00:00.000Z': snapshot('Old name'),
      '2025-01-01T00:00:00.000Z': snapshot('New name'),
    }), category)!

    expect(diffRegistries(current, candidate).changed)
      .toEqual([{ field: 'name', from: 'Old name', to: 'New name' }])
  })

  // the common generator writes a fresh single-snapshot registry rather than appending to one
  it('warns about history the new file drops', () => {
    const current = summarizeRegistry(registryWith({
      '2024-01-01T00:00:00.000Z': snapshot('Name'),
      '2025-01-01T00:00:00.000Z': snapshot('Name'),
    }), category)!
    const candidate = summarizeRegistry(registryWith({ '2025-01-01T00:00:00.000Z': snapshot('Name') }), category)!

    expect(diffRegistries(current, candidate).droppedSnapshots).toEqual(['2024-01-01T00:00:00.000Z'])
    expect(diffRegistries(current, candidate).changed).toEqual([])
  })
})
