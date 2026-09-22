import { describe, expect, it } from 'vitest'
import { staleTipHours } from '../src/utils/wallet/serverTip'

// the genesis block header, timestamped 2009-01-03 18:15:05 UTC
const genesis = {
  height: 0,
  hex: '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c',
}
const genesisMs = 1231006505 * 1000
const hourMs = 60 * 60 * 1000

describe('staleTipHours', () => {
  it('reads the timestamp out of the raw header', () => {
    expect(staleTipHours(genesis, genesisMs + 5 * hourMs)).toBe(5)
  })

  // an hour between blocks happens every few days, so it must not read as a stuck server
  it('keeps a tip of a few hours old current', () => {
    expect(staleTipHours(genesis, genesisMs + 10 * 60 * 1000)).toBeUndefined()
    expect(staleTipHours(genesis, genesisMs + 2.9 * hourMs)).toBeUndefined()
  })

  it('calls a tip stale from three hours', () => {
    expect(staleTipHours(genesis, genesisMs + 3 * hourMs)).toBe(3)
  })

  // a device clock behind the chain makes the tip look newer, never stale
  it('keeps a tip from the future current', () => {
    expect(staleTipHours(genesis, genesisMs - hourMs)).toBeUndefined()
  })
})
