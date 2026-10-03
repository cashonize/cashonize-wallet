import { describe, expect, it } from 'vitest'
import { bigIntToVmNumber, binToHex, hexToBin, hash160 } from '@bitauth/libauth'
import { contractAddress } from '../src/utils/contracts/redeemScript'

const pkh = '8ee26d6c9f58369f94864dc3630cdeb17fae2f2d'

// The hodl plugin's contract, built the way hodlContracts.ts builds it: the locktime as a minimal
// VM number, then OP_CHECKLOCKTIMEVERIFY OP_DROP around a P2PKH. Recognising what the wallet's own
// module writes is the test that the shape is read right.
function timelockScript(locktime: number, ownerPkh: string) {
  const locktimeBytes = bigIntToVmNumber(BigInt(locktime))
  const push = binToHex(Uint8Array.from([locktimeBytes.length, ...locktimeBytes]))
  return push + 'b17576a914' + ownerPkh + '88ac'
}

describe('contractAddress', () => {
  // the address is derived, so it cannot disagree with the script it is shown beside
  it('derives a p2sh20 address by hashing the script', () => {
    const script = timelockScript(800_000, pkh)
    const address = contractAddress(script, 'p2sh20', 'bitcoincash')

    expect(address).toBeDefined()
    expect(address).toMatch(/^bitcoincash:p/)
    // the same hash160 the hodl module matches announcements against
    expect(binToHex(hash160(hexToBin(script)))).toHaveLength(40)
  })

  it('derives a different address for p2sh32', () => {
    const script = timelockScript(800_000, pkh)

    expect(contractAddress(script, 'p2sh32', 'bitcoincash'))
      .not.toBe(contractAddress(script, 'p2sh20', 'bitcoincash'))
  })

  it('refuses a script that is not hex', () => {
    expect(contractAddress('not hex', 'p2sh20', 'bitcoincash')).toBeUndefined()
  })
})
