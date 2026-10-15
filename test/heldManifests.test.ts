import { describe, expect, it } from 'vitest'

import builtinContracts from '../src/utils/contracts/builtinContracts.json'
import { ContractManifestSchema, readLoan, readStake } from '../src/utils/contracts/contractManifest'
import { heldManifestFor } from '../src/utils/contracts/builtins'
import type { ParsedField } from '../src/parsing/nftParsing'

const loanCategory = 'aa'.repeat(32)
const receiptCategory = '7708645a7f30e97003573d9322202960a560a87527bef3666a30044a0dfdfa81'

const numberField = (field: Partial<ParsedField>, value: bigint, decimals: number): ParsedField => ({
  value: '', ...field,
  parsedValue: { type: 'number', value, decimals, formatted: String(value) },
})

describe('paryonusd-loan', () => {
  it('recognises the owner key of a category whose registry declares the extension', () => {
    const manifest = heldManifestFor('loan', { category: loanCategory, capability: 'minting' }, ['paryonusd'])
    expect(manifest?.id).toBe('paryonusd-loan')
  })

  // a management key shares the loan's category but does not control the loan
  it('leaves a management key alone', () => {
    expect(heldManifestFor('loan', { category: loanCategory, capability: 'none' }, ['paryonusd'])).toBeUndefined()
  })

  it('does not match before the registry is known', () => {
    expect(heldManifestFor('loan', { category: loanCategory, capability: 'minting' }, [])).toBeUndefined()
  })

  it('reads collateral in BCH and debt in USD from the named fields', () => {
    const manifest = heldManifestFor('loan', { category: loanCategory, capability: 'minting' }, ['paryonusd'])!
    const value = manifest.value!
    if (value.kind !== 'loan') throw new Error('not a loan manifest')

    const reading = readLoan(value, [
      numberField({ name: 'Collateral Amount' }, 150_000_000n, 8),
      numberField({ name: 'Borrowed Debt' }, 25_050n, 2),
    ])

    expect(reading.collateralBch).toBe(1.5)
    expect(reading.debtUsd).toBe(250.5)
  })
})

describe('paryonusd-stake', () => {
  // receipts are recognised by category, before their metadata has loaded
  it('recognises a receipt by category alone', () => {
    expect(heldManifestFor('stake', { category: receiptCategory, capability: 'none' }, [])?.id).toBe('paryonusd-stake')
    expect(heldManifestFor('loan', { category: receiptCategory, capability: 'none' }, [])).toBeUndefined()
  })

  it('reads the stake by field id', () => {
    const manifest = heldManifestFor('stake', { category: receiptCategory, capability: 'none' }, [])!
    const value = manifest.value!
    if (value.kind !== 'stake') throw new Error('not a stake manifest')

    const reading = readStake(value, [
      numberField({ fieldId: 'epochReceipt' }, 12n, 0),
      numberField({ fieldId: 'amountStakedReceipt' }, 10_000n, 2),
    ])

    expect(reading.stakedUsd).toBe(100)
    expect(reading.epochDisplay).toBe('12')
  })
})

it('refuses a held manifest that names neither categories nor an extension', () => {
  const loan = builtinContracts.contracts.find(contract => contract.id === 'paryonusd-loan')!
  const result = ContractManifestSchema.safeParse({ ...loan, find: { kind: 'held', capability: 'minting' } })
  expect(result.success).toBe(false)
})
