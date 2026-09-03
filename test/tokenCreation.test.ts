import { describe, expect, it } from 'vitest'

import type { Utxo } from 'mainnet-js'

import { formatTokens, genesisAmounts, genesisCandidates, metadataReadiness, type CheckedRegistry } from '../src/utils/tools/tokenCreation'

describe('genesisAmounts', () => {
  // the supply is typed in tokens and the decimals do the zeroes, since the on-chain number is
  // permanent and the arithmetic was the mistake three walkthroughs made
  it('turns tokens into base units by the chosen decimals', () => {
    expect(genesisAmounts('500,000', '200000', '2')).toEqual({
      supply: 50_000_000n, circulating: 20_000_000n, reserve: 30_000_000n,
    })
    expect(genesisAmounts('100.5', '0', '1')).toEqual({ supply: 1005n, circulating: 0n, reserve: 1005n })
  })

  it('reads an empty field as zero, so the split can be read while typing', () => {
    expect(genesisAmounts('1000', '', '0')).toEqual({ supply: 1000n, circulating: 0n, reserve: 1000n })
  })

  it('names what the genesis would refuse', () => {
    expect(genesisAmounts('100', '0', '19')).toBe('invalidDecimals')
    expect(genesisAmounts('100', '0', '-1')).toBe('invalidDecimals')
    expect(genesisAmounts('1.5', '0', '0')).toBe('invalidAmount')
    expect(genesisAmounts('abc', '0', '0')).toBe('invalidAmount')
    expect(genesisAmounts('9223372036854775808', '0', '0')).toBe('overMaxSupply')
    expect(genesisAmounts('100', '101', '0')).toBe('overSupply')
  })
})

describe('formatTokens', () => {
  it('shows amounts back as tokens with separators', () => {
    expect(formatTokens(50_000_000n, 2)).toBe('500,000')
    expect(formatTokens(1005n, 1)).toBe('100.5')
    expect(formatTokens(1234567n, 0)).toBe('1,234,567')
  })
})

describe('metadataReadiness', () => {
  const checked: CheckedRegistry = {
    uris: ['example.com'],
    summary: { name: 'Test', symbol: 'TST', decimals: 2, snapshots: [] },
    hash: 'ab'.repeat(32),
  }

  it('needs nothing while no location is typed', () => {
    expect(metadataReadiness([], undefined, 2)).toBe('none')
  })

  // Create must not commit to a hash the wallet has not fetched and verified
  it('needs a check once a location is typed, and again once it was edited', () => {
    expect(metadataReadiness(['example.com'], undefined, 2)).toBe('unchecked')
    expect(metadataReadiness(['other.example'], checked, 2)).toBe('unchecked')
    expect(metadataReadiness(['example.com', 'ipfs://bafy'], checked, 2)).toBe('unchecked')
  })

  // the supply was created for one number of decimals; a registry saying another would show
  // every balance wrong by powers of ten
  it('refuses a registry that disagrees on the decimals', () => {
    expect(metadataReadiness(['example.com'], checked, 0)).toBe('decimalsMismatch')
    expect(metadataReadiness(['example.com'], checked, 2)).toBe('ready')
  })

  it('reads a registry that says nothing about decimals as zero', () => {
    const noDecimals = { ...checked, summary: { name: 'Test', snapshots: [] } }
    expect(metadataReadiness(['example.com'], noDecimals, 0)).toBe('ready')
    expect(metadataReadiness(['example.com'], noDecimals, 2)).toBe('decimalsMismatch')
  })
})

describe('genesisCandidates', () => {
  const coin = (txid: string, vout: number, satoshis: bigint, token?: Utxo['token']): Utxo =>
    ({ txid, vout, satoshis, token }) as Utxo

  // an id is read from a UTXO at output 0, and a token UTXO already belongs to an identity
  it('offers the UTXOs at output 0 without a token, largest first', () => {
    const small = coin('a'.repeat(64), 0, 1000n)
    const large = coin('b'.repeat(64), 0, 5000n)
    const atOutputOne = coin('c'.repeat(64), 1, 9000n)
    const withToken = coin('d'.repeat(64), 0, 9000n, { category: 'e'.repeat(64), amount: 1n })
    expect(genesisCandidates([small, atOutputOne, withToken, large])).toEqual([large, small])
  })

  // an identity keeps the whole UTXO out of the spendable balance, so the small ones lead there
  it('offers the smallest first for an identity', () => {
    const small = coin('a'.repeat(64), 0, 1000n)
    const large = coin('b'.repeat(64), 0, 5000n)
    expect(genesisCandidates([large, small], 'smallest')).toEqual([small, large])
  })
})
