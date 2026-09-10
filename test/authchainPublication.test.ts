import { describe, expect, it, vi, afterEach } from 'vitest'
import { OpReturnData } from 'mainnet-js'
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth'

import { parsePublicationOutput, filledLocations } from '../src/utils/tools/authchainIdentity'
import {
  isSupportedLocation,
  publishedFormOf,
  registryUrlOf,
  registryContentHash,
  checkPublicationUri,
  fetchCandidateRegistry,
} from '../src/utils/tools/registryFile'

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

describe('publishedFormOf', () => {
  // the spec's example publishes the well-known location as the bare domain
  it('compacts the well-known URL to its domain', () => {
    expect(publishedFormOf('https://example.com/.well-known/bitcoin-cash-metadata-registry.json')).toBe('example.com')
    expect(publishedFormOf('example.com/.well-known/bitcoin-cash-metadata-registry.json')).toBe('example.com')
  })

  it('drops the scheme and keeps any other path, the root included', () => {
    expect(publishedFormOf('https://example.com')).toBe('example.com')
    expect(publishedFormOf('https://example.com/registry.json')).toBe('example.com/registry.json')
    expect(publishedFormOf('https://example.com/')).toBe('example.com/')
  })

  it('leaves an IPFS location as it is', () => {
    expect(publishedFormOf('ipfs://bafyexamplecid')).toBe('ipfs://bafyexamplecid')
  })

  // whatever was typed, the compact form is read back to the same place
  it('resolves to the same URL as what was typed', () => {
    const typed = [
      'https://example.com/.well-known/bitcoin-cash-metadata-registry.json',
      'https://example.com/',
      'https://example.com/registry.json',
      'example.com',
    ]
    for (const uri of typed) {
      expect(registryUrlOf(publishedFormOf(uri), ipfsGateway)).toBe(registryUrlOf(uri, ipfsGateway))
    }
  })

  it('is what the locations form publishes', () => {
    expect(filledLocations([' https://example.com/.well-known/bitcoin-cash-metadata-registry.json ', '', 'ipfs://bafy']))
      .toEqual(['example.com', 'ipfs://bafy'])
  })
})

describe('isSupportedLocation', () => {
  it('accepts HTTPS, with or without the scheme, and ipfs://', () => {
    expect(isSupportedLocation('example.com')).toBe(true)
    expect(isSupportedLocation('https://example.com/registry.json')).toBe(true)
    expect(isSupportedLocation('ipfs://bafyexamplecid')).toBe(true)
  })

  // the spec serves DNS registries over HTTPS only; read back, http:// would name a garbage URL
  it('refuses any other scheme', () => {
    expect(isSupportedLocation('http://example.com')).toBe(false)
    expect(isSupportedLocation('ftp://example.com/registry.json')).toBe(false)
  })
})

describe('checkPublicationUri', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubServedContent(content: string) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(utf8ToBin(content).buffer),
    }))
  }

  it('verifies a location serving what the hash commits to', async () => {
    stubServedContent(registry)

    expect(await checkPublicationUri('example.com', registryHash, ipfsGateway)).toBe('verified')
  })

  // the hosted file was edited without a matching publication, which is what the badge is for
  it('reports a location serving something else as changed', async () => {
    stubServedContent('{"version":{"major":2,"minor":0,"patch":0}}')

    expect(await checkPublicationUri('example.com', registryHash, ipfsGateway))
      .toBe('changed')
  })

  it('reports a location that does not answer as unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    expect(await checkPublicationUri('example.com', registryHash, ipfsGateway))
      .toBe('unreachable')
  })

  it('reports an error response as unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }))

    expect(await checkPublicationUri('example.com', registryHash, ipfsGateway))
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
    expect(registryContentHash(utf8ToBin(registry))).toBe(registryHash)
  })

  // a file saved with a byte order mark hashes as served, since that is what other verifiers see;
  // decoding it to text first would drop the mark and hash a file nobody else can reproduce
  it('keeps a byte order mark in the hash', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8ToBin(registry)])
    expect(registryContentHash(withBom)).not.toBe(registryHash)
    expect(registryContentHash(withBom)).toBe(binToHex(sha256.hash(withBom)))
  })
})

// The hash that goes on chain commits to every location at once, so the candidate is fetched from
// all of them and they have to agree byte for byte
describe('fetchCandidateRegistry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // what each location serves, by the url it is fetched from
  function stubHosts(served: Record<string, string | undefined>) {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const content = served[url]
      if (content === undefined) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(utf8ToBin(content).buffer) })
    }))
  }

  it('refuses a location with another scheme before fetching anything', async () => {
    stubHosts({})

    await expect(fetchCandidateRegistry(['http://example.com'], ipfsGateway)).rejects.toThrow('http://example.com')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns the file and its hash when every mirror agrees', async () => {
    stubHosts({
      'https://example.com/.well-known/bitcoin-cash-metadata-registry.json': registry,
      'https://ipfs.example.com/ipfs/bafyexamplecid': registry,
    })

    const candidate = await fetchCandidateRegistry(['example.com', 'ipfs://bafyexamplecid'], ipfsGateway)

    expect(candidate).toEqual({ hash: registryHash, content: registry })
  })

  it('refuses a mirror serving something else, naming it', async () => {
    stubHosts({
      'https://example.com/.well-known/bitcoin-cash-metadata-registry.json': registry,
      'https://ipfs.example.com/ipfs/bafyexamplecid': '{"version":{"major":2,"minor":0,"patch":0}}',
    })

    await expect(fetchCandidateRegistry(['example.com', 'ipfs://bafyexamplecid'], ipfsGateway))
      .rejects.toThrow('ipfs://bafyexamplecid')
  })

  it('refuses when a location does not answer', async () => {
    stubHosts({ 'https://example.com/.well-known/bitcoin-cash-metadata-registry.json': registry })

    await expect(fetchCandidateRegistry(['example.com', 'ipfs://bafyexamplecid'], ipfsGateway))
      .rejects.toThrow('ipfs://bafyexamplecid')
  })
})
