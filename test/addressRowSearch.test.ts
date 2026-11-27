import { describe, expect, it } from 'vitest'
import type { Utxo } from '@cashonize/bch-wallet-lib'
import { addressRowMatches, type AddressRow } from '../src/utils/wallet/addressRows'

const category = 'c1'.repeat(32)
const tokenUtxo = { token: { category, amount: 5n } } as unknown as Utxo
const row = (overrides: Partial<AddressRow> = {}): AddressRow => ({
  index: 9,
  address: 'bitcoincash:qz8wymtv9f5l6n3xk0v0w7k3m2c4d5e6f7hczr7px4',
  tokenAddress: 'bitcoincash:zz8wymtv9f5l6n3xk0v0w7k3m2c4d5e6f7s0m3t0k3n',
  balance: 0n,
  spendableBalance: 0n,
  reservedBalance: 0n,
  txCount: 0,
  utxos: [],
  ...overrides,
})
const noTokens = () => ''
const furu = (asked: string) => asked === category ? 'Furu Token FURU' : ''
const matches = (query: string, overrides: Partial<AddressRow> = {}, label?: string) =>
  addressRowMatches(row(overrides), query, label, overrides.utxos ? furu : noTokens)

describe('addressRowMatches', () => {
  it('takes every row for an empty search', () => {
    expect(matches('')).toBe(true)
    expect(matches('   ')).toBe(true)
  })

  it('finds an address by either form, in full or in part, with or without the prefix', () => {
    expect(matches('bitcoincash:qz8wymtv9f5l6n3xk0v0w7k3m2c4d5e6f7hczr7px4')).toBe(true)
    expect(matches('bitcoincash:zz8wymtv9f5l6n3xk0v0w7k3m2c4d5e6f7s0m3t0k3n')).toBe(true)
    expect(matches('qz8wymtv')).toBe(true)
    expect(matches('HCZR7PX4')).toBe(true)
    expect(matches('qqqqother')).toBe(false)
  })

  // digits are in nearly every address, so alone they mean the index, and all of it
  it('reads a number as the index, not as part of an address', () => {
    expect(matches('9')).toBe(true)
    expect(matches('7')).toBe(false)
    expect(matches('19')).toBe(false)
    expect(matches('9', { index: 19 })).toBe(false)
  })

  it('finds a row by its label, a numeric one included', () => {
    expect(matches('savings', {}, 'My Savings')).toBe(true)
    expect(matches('2024', {}, 'Rent 2024')).toBe(true)
    expect(matches('savings', {}, 'Rent')).toBe(false)
    expect(matches('savings')).toBe(false)
  })

  it('finds a row by a token it holds: its name, its symbol or its full id', () => {
    const holding = { utxos: [tokenUtxo] }
    expect(matches('furu', holding)).toBe(true)
    expect(matches('Furu Tok', holding)).toBe(true)
    expect(matches(category, holding)).toBe(true)
    expect(matches('other', holding)).toBe(false)
    // the token's name does not find a row that holds none of it
    expect(addressRowMatches(row(), 'furu', undefined, furu)).toBe(false)
  })
})
