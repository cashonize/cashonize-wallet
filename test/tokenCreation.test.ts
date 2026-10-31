import { describe, expect, it } from 'vitest'

import { InvalidRequestError, TokenSendRequest, type Utxo } from '@cashonize/bch-wallet-lib'

import { circulationOutputs, genesisAmounts, genesisCandidates, metadataReadiness, type CheckedRegistry } from '../src/utils/tools/tokenCreation'

describe('genesisAmounts', () => {
  // the supply is typed in tokens and the decimals do the zeroes, since the on-chain number is
  // permanent and the arithmetic was the mistake three walkthroughs made
  it('turns tokens into base units by the chosen decimals', () => {
    expect(genesisAmounts('500000', '200000', '2')).toEqual({
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
    expect(genesisAmounts('1.5', '0', '0')).toBe('tooManyDecimals')
    expect(genesisAmounts('1.123', '0', '2')).toBe('tooManyDecimals')
    expect(genesisAmounts('abc', '0', '0')).toBe('invalidAmount')
    // a comma is refused, not dropped: dropping it read a decimal comma as a far larger supply
    expect(genesisAmounts('0,5', '0', '2')).toBe('commaInAmount')
    expect(genesisAmounts('500,000', '0', '2')).toBe('commaInAmount')
    expect(genesisAmounts('9223372036854775808', '0', '0')).toBe('overMaxSupply')
    expect(genesisAmounts('100', '101', '0')).toBe('overSupply')
  })

  // the cap is on the base units, so the decimals count against it: what fits at 0 does not at 18
  it('holds the cap exactly, in base units', () => {
    expect(genesisAmounts('9223372036854775807', '0', '0')).toEqual({
      supply: 9223372036854775807n, circulating: 0n, reserve: 9223372036854775807n,
    })
    expect(genesisAmounts('10000000000', '0', '18')).toBe('overMaxSupply')
    expect(genesisAmounts('9.223372036854775807', '0', '18')).toEqual({
      supply: 9223372036854775807n, circulating: 0n, reserve: 9223372036854775807n,
    })
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

describe('circulationOutputs', () => {
  const tokenAddress = 'bitcoincash:zr7fzmep8g7h7ymfxy74lgc0v950j3r295z4y4gq0v'
  const category = 'a'.repeat(64)

  // the library refuses a token output with neither an amount nor an NFT, so a genesis that keeps
  // the whole supply in the reserve must not build one
  it('issues nothing when the whole supply stays in the reserve', () => {
    expect(circulationOutputs(tokenAddress, category, 0n, 1000n)).toEqual([])
    expect(() => new TokenSendRequest({ cashaddr: tokenAddress, category, amount: 0n })).toThrow(InvalidRequestError)
  })

  it('issues the circulating amount as one token output', () => {
    const outputs = circulationOutputs(tokenAddress, category, 500n, 1000n)
    expect(outputs).toHaveLength(1)
    expect(outputs[0]).toMatchObject({ cashaddr: tokenAddress, category, amount: 500n, value: 1000n })
  })
})
