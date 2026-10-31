import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ Notify: { create: vi.fn() } }))

import { cachedFetch } from '../src/utils/cacheUtils'

const DAY_MS = 24 * 60 * 60 * 1000

// A localStorage that holds a limited number of characters, throwing the browser's quota error
// for a write that would go over it
function limitedLocalStorage(capacity: number) {
  const store = new Map<string, string>()
  const used = () => [...store].reduce((total, [key, value]) => total + key.length + value.length, 0)
  return {
    store,
    get length() { return store.size },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const freed = store.has(key) ? key.length + store.get(key)!.length : 0
      if (used() - freed + key.length + value.length > capacity) {
        throw new DOMException('full', 'QuotaExceededError')
      }
      store.set(key, value)
    },
    removeItem: (key: string) => { store.delete(key) },
  }
}

const cacheEntry = (ageMs: number) => JSON.stringify({
  timestamp: Date.now() - ageMs,
  simpleResponse: { responseText: '{"old":true}', status: 200, url: 'https://old.example' },
})

const url = 'https://indexer.example/token'

describe('cachedFetch on a full localStorage', () => {
  let storage: ReturnType<typeof limitedLocalStorage>

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"name":"token"}', { status: 200 }))))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('removes expired and corrupt cache entries to make room, and nothing else', async () => {
    storage = limitedLocalStorage(900)
    vi.stubGlobal('localStorage', storage)
    storage.setItem('cachedFetch-expired', cacheEntry(8 * DAY_MS))
    storage.setItem('cachedFetch-corrupt', '{not json' + 'x'.repeat(100))
    storage.setItem('cachedFetch-fresh', cacheEntry(DAY_MS))
    storage.setItem('reservedUtxos-mainnet-mywallet', 'x'.repeat(380))

    const response = await cachedFetch(url)

    expect(await response.json()).toEqual({ name: 'token' })
    expect(storage.store.has('cachedFetch-expired')).toBe(false)
    expect(storage.store.has('cachedFetch-corrupt')).toBe(false)
    expect(storage.store.has('cachedFetch-fresh')).toBe(true)
    expect(storage.store.has('reservedUtxos-mainnet-mywallet')).toBe(true)
    // the entry was written: the second call is served from the cache
    await cachedFetch(url)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('still returns the response when no room can be made', async () => {
    storage = limitedLocalStorage(200)
    vi.stubGlobal('localStorage', storage)
    storage.setItem('reservedUtxos-mainnet-mywallet', 'x'.repeat(150))

    const response = await cachedFetch(url)

    expect(await response.json()).toEqual({ name: 'token' })
  })

  it('reads a corrupt entry as a miss rather than throwing', async () => {
    storage = limitedLocalStorage(10_000)
    vi.stubGlobal('localStorage', storage)
    await cachedFetch(url)
    const [key] = [...storage.store.keys()]
    storage.setItem(key!, '{not json')

    const response = await cachedFetch(url)

    expect(await response.json()).toEqual({ name: 'token' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
