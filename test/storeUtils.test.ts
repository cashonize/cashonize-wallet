import { describe, expect, it } from 'vitest'

import { parseIndexerResponse } from '../src/stores/storeUtils'

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
