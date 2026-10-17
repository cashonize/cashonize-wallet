import { describe, expect, it } from 'vitest'

import { Config, OpReturnData, type TokenSendRequest, type Utxo } from 'mainnet-js'
import { binToHex, cashAddressToLockingBytecode, CashAddressNetworkPrefix, encodeCashAddress } from '@bitauth/libauth'

import {
  authGuardGenesisOutputs,
  authKeyGenesisInput,
  genesisAmounts,
  genesisCandidates,
  metadataReadiness,
  type CheckedRegistry,
} from '../src/utils/tools/tokenCreation'
import { isAuthGuardOf, isAuthKey } from '../src/utils/tools/authGuard'

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

describe('authKeyGenesisInput', () => {
  const coin = (txid: string, satoshis: bigint): Utxo => ({ txid, vout: 0, satoshis }) as Utxo

  // two categories from one coin is impossible, so the token's own input is never the key's
  it('picks the smallest candidate other than the token input', () => {
    const small = coin('a'.repeat(64), 1000n)
    const large = coin('b'.repeat(64), 5000n)
    expect(authKeyGenesisInput([large, small], small)).toBe(large)
    expect(authKeyGenesisInput([large, small], large)).toBe(small)
    expect(authKeyGenesisInput([small], small)).toBeUndefined()
  })
})

describe('authGuardGenesisOutputs', () => {
  Config.EnforceCashTokenReceiptAddresses = true
  const tokenCategory = 'aa'.repeat(32)
  const keyCategory = 'bcc5157eb69f0fcf80593c69ac08a3f28a1e726d55d0be6330ccaba4ed94c307'
  const walletTokenAddress = encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkhWithTokens', payload: new Uint8Array(20) }).address
  const genesis = {
    tokenCategory, keyCategory, prefix: CashAddressNetworkPrefix.mainnet, walletTokenAddress,
    reserve: 700n, mintingNft: false, circulating: 300n,
  }
  const lockingOf = (request: TokenSendRequest) => {
    const decoded = cashAddressToLockingBytecode(request.cashaddr)
    if (typeof decoded === 'string') throw new Error(decoded)
    return binToHex(decoded.bytecode)
  }

  // a wrong guard address locks the identity for good, so output 0 is checked against the covenant
  // the key at output 1 opens, at the P2SH20 form CashTokens Studio watches
  it('puts the guard at output 0, opened by the key at output 1', () => {
    const [guard, key] = authGuardGenesisOutputs(genesis) as TokenSendRequest[]
    expect(guard!.category).toBe(tokenCategory)
    expect(guard!.amount).toBe(700n)
    expect(guard!.nft).toBeUndefined()
    expect(isAuthGuardOf(key!.category, lockingOf(guard!))).toBe(true)
    expect(lockingOf(guard!)).toBe('a9146a59d6c4546b759fe4e67258bae954f03335f7a187')
    expect(key!.cashaddr).toBe(walletTokenAddress)
    expect(isAuthKey({ token: { ...key!, amount: key!.amount } } as unknown as Utxo, keyCategory, '00')).toBe(true)
  })

  it('follows with circulation and the publication, in the standard\'s order', () => {
    const publication = OpReturnData.fromArray(['BCMR'])
    const outputs = authGuardGenesisOutputs({ ...genesis, mintingNft: true, publication })
    expect(outputs).toHaveLength(4)
    expect((outputs[0] as TokenSendRequest).nft?.capability).toBe('minting')
    expect((outputs[2] as TokenSendRequest).category).toBe(tokenCategory)
    expect((outputs[2] as TokenSendRequest).amount).toBe(300n)
    expect(outputs[3]).toBe(publication)
  })

  it('leaves out an empty circulation output', () => {
    expect(authGuardGenesisOutputs({ ...genesis, circulating: 0n })).toHaveLength(2)
  })
})
