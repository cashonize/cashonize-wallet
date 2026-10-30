import { beforeEach, describe, expect, it, vi } from 'vitest'
import { curatedElectrumServers, electrumServerList, storedElectrumMode } from '../src/utils/wallet/electrumServers'

const curated = curatedElectrumServers.mainnet

describe('the servers a mode may use', () => {
  // the privacy promise of single: no other server, whatever was last good
  it('single is the pick alone, also when it is curated and another server worked last', () => {
    expect(electrumServerList('single', 'bch.loping.net', 'fulcrum.greyh.at', curated)).toEqual(['bch.loping.net'])
    expect(electrumServerList('single', 'my.own.server', null, curated)).toEqual(['my.own.server'])
  })

  it('automatic puts the last server that worked first, then the rest of the list in its order', () => {
    const list = electrumServerList('automatic', 'electrum.imaginary.cash', 'fulcrum.greyh.at', curated)
    expect(list[0]).toBe('fulcrum.greyh.at')
    expect(list.slice(1)).toEqual(curated.filter(server => server !== 'fulcrum.greyh.at'))
  })

  it('automatic ignores a last good server that is not on the list', () => {
    expect(electrumServerList('automatic', 'electrum.imaginary.cash', 'my.own.server', curated)).toEqual([...curated])
  })

  it('preferred puts the pick first and ignores the last good server', () => {
    const list = electrumServerList('preferred', 'bch.loping.net', 'fulcrum.greyh.at', curated)
    expect(list[0]).toBe('bch.loping.net')
    expect(list).toHaveLength(curated.length)
  })

  it('never mixes a custom server into the curated list', () => {
    expect(electrumServerList('preferred', 'my.own.server', null, curated)).toEqual(['my.own.server'])
  })
})

describe('the mode read at startup', () => {
  const stored: Record<string, string> = {}
  beforeEach(() => {
    for (const key of Object.keys(stored)) delete stored[key]
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored[key] ?? null })
  })

  // a stored server was the user's own pick, which meant that server only
  it('is single for a server picked before the modes, curated or custom', () => {
    stored['electrum-mainnet'] = 'bch.loping.net'
    stored['electrum-chipnet'] = 'my.own.server'
    expect(storedElectrumMode('mainnet')).toBe('single')
    expect(storedElectrumMode('chipnet')).toBe('single')
  })

  it('is automatic without a stored server', () => {
    expect(storedElectrumMode('mainnet')).toBe('automatic')
  })

  it('is the stored mode once there is one', () => {
    stored['electrum-mainnet'] = 'bch.loping.net'
    stored['electrumMode-mainnet'] = 'preferred'
    expect(storedElectrumMode('mainnet')).toBe('preferred')
  })
})
