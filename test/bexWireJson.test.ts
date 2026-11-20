import { describe, expect, it } from 'vitest'
import { stringify } from '@bitauth/libauth'

import { toWireJson } from '../src/utils/bex/wireJson'
import { parseExtendedJson } from '../src/utils/utils'
import { LooseEncodedWcTransactionObjSchema } from '../src/utils/zodValidation'
import { cashNinjaJsonString1 } from './fixtures/wcFixtures'

// What a dApp holds before its WalletConnect connector serializes it: libauth objects with
// Uint8Array and bigint fields
const libauthRequest = parseExtendedJson(cashNinjaJsonString1) as Record<string, unknown>

describe('the browser provider wire form', () => {
  it('is what a WalletConnect connector sends: libauth stringify, parsed as JSON', () => {
    expect(toWireJson(libauthRequest)).toEqual(JSON.parse(stringify(libauthRequest)))
  })

  it('parses back to the dApp objects in the wallet', () => {
    const wire = toWireJson(libauthRequest)
    expect(parseExtendedJson(JSON.stringify(wire))).toEqual(libauthRequest)
    expect(LooseEncodedWcTransactionObjSchema.safeParse(wire).success).toBe(true)
  })

  it('leaves params already in the wire form as they are', () => {
    const wire = JSON.parse(cashNinjaJsonString1) as unknown
    expect(toWireJson(wire)).toEqual(wire)
    expect(toWireJson(undefined)).toBeUndefined()
  })
})
