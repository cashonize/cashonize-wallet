import { describe, expect, it } from 'vitest'

import {
  BEX_PROVIDER_STATE_KEY,
  changedAccounts,
  isWebOrigin,
  itemsBefore,
  normalizePermission,
  permissionKey,
  permissionsFrom,
  storageView,
  visibleAccounts,
  type BexProviderState,
} from '../src/utils/bex/permissions'

const walletA = 'chipnet:bchtest:qwalleta'
const walletB = 'chipnet:bchtest:qwalletb'
const state = (walletId: string, chainId = 'bch:bchtest'): BexProviderState => ({ chainId, network: 'chipnet', walletId })
const permission = (accounts: string[], walletId = walletA) => ({ accounts, walletId, connectedAt: 1 })

describe('the permissions of the browser provider', () => {
  it('takes a site for an http(s) origin only', () => {
    expect(isWebOrigin('https://dapp.example')).toBe(true)
    expect(isWebOrigin('http://localhost:5188')).toBe(true)
    // a sandboxed document's opaque origin, which every such page shares
    expect(isWebOrigin('null')).toBe(false)
    expect(isWebOrigin('chrome-extension://abc')).toBe(false)
    expect(isWebOrigin('https://dapp.example/path')).toBe(false)
    expect(isWebOrigin(undefined)).toBe(false)
  })

  it('keeps a permission only with its accounts and the wallet they belong to', () => {
    expect(normalizePermission(permission(['bchtest:qa']))).toEqual(permission(['bchtest:qa']))
    expect(normalizePermission({ accounts: ['bchtest:qa'], connectedAt: 1 })).toBeUndefined()
    expect(normalizePermission(permission([]))).toBeUndefined()
    expect(normalizePermission(true)).toBeUndefined()
  })

  it('reads each site from its own key, and nothing else', () => {
    const permissions = permissionsFrom({
      [permissionKey('https://a.example')]: permission(['bchtest:qa']),
      [permissionKey('null')]: permission(['bchtest:qa']),
      [permissionKey('__proto__')]: permission(['bchtest:qa']),
      [BEX_PROVIDER_STATE_KEY]: state(walletA),
      bexPendingRequests: [],
    })
    expect(Object.keys(permissions)).toEqual(['https://a.example'])
  })

  it('shows a site its accounts only while their wallet is open', () => {
    const connected = permission(['bchtest:qa'])
    expect(visibleAccounts(connected, state(walletA))).toEqual(['bchtest:qa'])
    expect(visibleAccounts(connected, state(walletB))).toEqual([])
    expect(visibleAccounts(connected, undefined)).toEqual([])
    expect(visibleAccounts(undefined, state(walletA))).toEqual([])
  })

  it('tells only the site that was approved, and only of its own accounts', () => {
    const before = storageView({
      [permissionKey('https://b.example')]: permission(['bchtest:qb3']),
      [BEX_PROVIDER_STATE_KEY]: state(walletA),
    })
    const after = storageView({
      [permissionKey('https://a.example')]: permission(['bchtest:qa0']),
      [permissionKey('https://b.example')]: permission(['bchtest:qb3']),
      [BEX_PROVIDER_STATE_KEY]: state(walletA),
    })
    expect(changedAccounts(before, after)).toEqual([{ origin: 'https://a.example', accounts: ['bchtest:qa0'] }])
  })

  it('tells the sites of the wallet left and of the wallet opened, and no other', () => {
    const permissions = {
      [permissionKey('https://a.example')]: permission(['bchtest:qa0'], walletA),
      [permissionKey('https://b.example')]: permission(['bchtest:qb0'], walletB),
      [permissionKey('https://c.example')]: permission(['bchtest:qc0'], 'chipnet:bchtest:qwalletc'),
    }
    const before = storageView({ ...permissions, [BEX_PROVIDER_STATE_KEY]: state(walletA) })
    const after = storageView({ ...permissions, [BEX_PROVIDER_STATE_KEY]: state(walletB) })
    expect(changedAccounts(before, after)).toEqual([
      { origin: 'https://a.example', accounts: [] },
      { origin: 'https://b.example', accounts: ['bchtest:qb0'] },
    ])
  })

  it('tells nothing when the wallet page opens the same wallet again', () => {
    const items = {
      [permissionKey('https://a.example')]: permission(['bchtest:qa0']),
      [BEX_PROVIDER_STATE_KEY]: state(walletA),
    }
    expect(changedAccounts(storageView(items), storageView({ ...items }))).toEqual([])
  })

  it('rebuilds the storage before a change from the items after it', () => {
    const after = { [permissionKey('https://a.example')]: permission(['bchtest:qa0']), kept: 1 }
    const before = itemsBefore(after, {
      [permissionKey('https://a.example')]: { newValue: permission(['bchtest:qa0']) },
      [permissionKey('https://b.example')]: { oldValue: permission(['bchtest:qb0']) },
    })
    expect(before).toEqual({ [permissionKey('https://b.example')]: permission(['bchtest:qb0']), kept: 1 })
  })
})
