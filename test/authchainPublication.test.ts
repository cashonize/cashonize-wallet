import { describe, expect, it, vi, afterEach } from 'vitest'
import { OpReturnData, sha256, utf8ToBin } from 'mainnet-js'
import { binToHex } from '@bitauth/libauth'

import {
  parsePublicationOutput,
  registryUrlOf,
  registryContentHash,
  checkPublicationUri,
} from '../src/utils/tools/authchainIdentity'

const ipfsGateway = 'https://ipfs.example.com/ipfs/'
const registry = '{"version":{"major":1,"minor":0,"patch":0}}'
const registryHash = binToHex(sha256.hash(utf8ToBin(registry)))

// Built the way the wallet itself publishes one, so the parser is read against the writer
function publicationOutput(hash: string, uris: string[]) {
  const chunks: (string | Uint8Array)[] = ['BCMR', Uint8Array.from(Buffer.from(hash, 'hex')), ...uris]
  return binToHex(OpReturnData.fromArray(chunks).buffer)
}

describe('parsePublicationOutput', () => {
  it('reads the hash and every location out of a publication output', () => {
    const parsed = parsePublicationOutput(publicationOutput(registryHash, [
      'ipfs://bafyexamplecid', 'example.com',
    ]))

    expect(parsed).toEqual({ hash: registryHash, uris: ['ipfs://bafyexamplecid', 'example.com'] })
  })

  it('reads a publication that names a single location', () => {
    const parsed = parsePublicationOutput(publicationOutput(registryHash, ['example.com']))

    expect(parsed?.uris).toEqual(['example.com'])
  })

  // any other OP_RETURN of the same transaction, a plain message or another protocol's marker
  it('is not fooled by an OP_RETURN that is not a publication', () => {
    const message = binToHex(OpReturnData.fromString('hello').buffer)

    expect(parsePublicationOutput(message)).toBeUndefined()
  })
})

describe('registryUrlOf', () => {
  // per spec a bare domain names the registry at a well-known path
  it('expands a domain to its well-known registry path', () => {
    expect(registryUrlOf('example.com', ipfsGateway))
      .toBe('https://example.com/.well-known/bitcoin-cash-metadata-registry.json')
  })

  // the two domain forms are not the same location: a trailing slash names the root itself
  it('leaves a domain published with a trailing slash at its root', () => {
    expect(registryUrlOf('example.com/', ipfsGateway)).toBe('https://example.com/')
  })

  it('leaves a location that names a file alone', () => {
    expect(registryUrlOf('example.com/registry.json', ipfsGateway))
      .toBe('https://example.com/registry.json')
  })

  // the published form has the scheme stripped, but a publisher may include it anyway
  it('accepts a location published with its scheme', () => {
    expect(registryUrlOf('https://example.com/registry.json', ipfsGateway))
      .toBe('https://example.com/registry.json')
  })

  it('fetches an IPFS location through the configured gateway', () => {
    expect(registryUrlOf('ipfs://bafyexamplecid', ipfsGateway))
      .toBe('https://ipfs.example.com/ipfs/bafyexamplecid')
  })
})

describe('checkPublicationUri', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubServedContent(content: string) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(content),
    }))
  }

  it('verifies a location serving what the hash commits to', async () => {
    stubServedContent(registry)

    expect(await checkPublicationUri('example.com', registryHash, ipfsGateway))
      .toEqual({ uri: 'example.com', status: 'verified' })
  })

  // the hosted file was edited without a matching publication, which is what the badge is for
  it('reports a location serving something else as changed', async () => {
    stubServedContent('{"version":{"major":2,"minor":0,"patch":0}}')

    expect((await checkPublicationUri('example.com', registryHash, ipfsGateway)).status)
      .toBe('changed')
  })

  it('reports a location that does not answer as unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    expect((await checkPublicationUri('example.com', registryHash, ipfsGateway)).status)
      .toBe('unreachable')
  })

  it('reports an error response as unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve('') }))

    expect((await checkPublicationUri('example.com', registryHash, ipfsGateway)).status)
      .toBe('unreachable')
  })

  // never through the metadata cache: the question is what the host serves now
  it('asks the host rather than a cache', async () => {
    stubServedContent(registry)

    await checkPublicationUri('example.com', registryHash, ipfsGateway)

    const [, options] = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(options.cache).toBe('no-store')
  })
})

describe('registryContentHash', () => {
  // the wallet publishes this same hash, so verifying and publishing can never drift apart
  it('hashes the file bytes as served', () => {
    expect(registryContentHash(registry)).toBe(registryHash)
  })
})
