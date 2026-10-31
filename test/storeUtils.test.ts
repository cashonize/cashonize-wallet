import { describe, expect, it, vi } from 'vitest'

import { fetchNftMetadata, fetchTokenMetadata, parseIndexerResponse } from '../src/stores/storeUtils'
import type { BcmrTokenMetadata } from '../src/interfaces/interfaces'
import { cachedFetch } from '../src/utils/cacheUtils'

vi.mock('../src/utils/cacheUtils', () => ({ cachedFetch: vi.fn() }))

const category = '0123456789abcdef'.repeat(4)

describe('parseIndexerResponse', () => {
  it('reads a token reply', async () => {
    const body = { name: 'Token', description: '', token: { category, symbol: 'TKN' } }
    const response = new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

    const parsed = await parseIndexerResponse(response)

    expect(parsed?.token?.category).toBe(category)
  })

  // a custom indexer URL pointing at a host that answers every path with its own page: the
  // reply is a 200 that is not JSON, and the wallet init awaits this
  it('returns undefined for a reply that is not JSON', async () => {
    const response = new Response('<!doctype html><html><body>Not found</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })

    await expect(parseIndexerResponse(response)).resolves.toBeUndefined()
  })

  it("returns undefined for the indexer's own error reply", async () => {
    const response = new Response(JSON.stringify({ error: 'not found' }), { status: 200 })

    await expect(parseIndexerResponse(response)).resolves.toBeUndefined()
  })
})

// Every metadata fetch fills the store's one registries object, so this rule is what keeps them
// from undoing each other: a category is added only when missing, and an NFT's answer goes into
// the category's nfts map
describe('filling one registries object', () => {
  const indexer = 'https://indexer.test/api'
  const commitment = '01'
  vi.mocked(cachedFetch).mockImplementation((url: string) => {
    const isNftLookup = url.endsWith(`/${commitment}/`)
    const body = {
      name: 'Collection', description: '', uris: {}, token: { category, symbol: 'COL' },
      ...(isNftLookup && { type_metadata: { name: 'Item #1', description: '' } }),
    }
    const response = new Response(JSON.stringify(body), { status: 200 })
    Object.defineProperty(response, 'url', { value: url })
    return Promise.resolve(response)
  })

  it("keeps an NFT's metadata when the category's own answer lands after it", async () => {
    const registries: Record<string, BcmrTokenMetadata> = {}
    await fetchNftMetadata(category, commitment, indexer, registries)
    await fetchTokenMetadata([{ category, amount: 0n }], false, indexer, registries)
    expect(registries[category]?.nfts?.[commitment]?.name).toBe('Item #1')
  })

  it("adds an NFT's metadata to a category that is already there", async () => {
    const registries: Record<string, BcmrTokenMetadata> = {}
    await fetchTokenMetadata([{ category, amount: 0n }], false, indexer, registries)
    await fetchNftMetadata(category, commitment, indexer, registries)
    expect(registries[category]?.nfts?.[commitment]?.name).toBe('Item #1')
  })
})
