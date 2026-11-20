import { describe, expect, it } from 'vitest'

import { BexRequestAccountsParamsSchema } from '../src/utils/zodValidation'

describe('the params of the browser provider bch_requestAccounts', () => {
  it('takes the network the dApp needs and its self-declared metadata', () => {
    const parsed = BexRequestAccountsParamsSchema.parse({
      chainId: 'bch:bitcoincash',
      dappMetadata: { name: 'Example', icons: ['https://example.com/icon.png'] },
    })
    expect(parsed).toEqual({ chainId: 'bch:bitcoincash', dappMetadata: { name: 'Example', icons: ['https://example.com/icon.png'] } })
  })

  // the metadata is cosmetic; the network decides whether the wallet may connect at all
  it('leaves out fields that do not validate, but refuses a network it cannot read', () => {
    const parsed = BexRequestAccountsParamsSchema.parse({
      chainId: 'bch:bchtest',
      dappMetadata: { name: '', icons: ['https://example.com/icon.png'] },
    })
    expect(parsed).toEqual({
      chainId: 'bch:bchtest',
      dappMetadata: { icons: ['https://example.com/icon.png'] },
    })
    expect(BexRequestAccountsParamsSchema.safeParse({ chainId: 1 }).success).toBe(false)
    expect(BexRequestAccountsParamsSchema.parse({})).toEqual({ dappMetadata: undefined })
  })

  it('keeps a usable name and description when the icon is not', () => {
    const parsed = BexRequestAccountsParamsSchema.parse({
      dappMetadata: {
        name: '  Example  ',
        description: 'A dApp',
        icons: ['http://example.com/icon.png'],
      },
    })
    expect(parsed.dappMetadata).toEqual({ name: 'Example', description: 'A dApp' })
  })

  it('takes an http icon from local development', () => {
    const parsed = BexRequestAccountsParamsSchema.parse({
      dappMetadata: { name: 'Example', icons: ['http://localhost:5188/icon.png'] },
    })
    expect(parsed.dappMetadata).toEqual({ name: 'Example', icons: ['http://localhost:5188/icon.png'] })
  })
})
