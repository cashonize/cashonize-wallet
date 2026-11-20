import { beforeEach, describe, expect, it } from 'vitest'
import { localStorageMock } from './mocks/store.mocks'
import { builtinBundle } from '../src/utils/contracts/builtins'
import { ContractManifestSchema } from '../src/utils/contracts/contractManifest'
import {
  activeDiscoveryBundles,
  deleteDiscoveryBundle,
  discoveryManifests,
  loadDiscoveryBundles,
  readBundle,
  saveDiscoveryBundle,
} from '../src/utils/contracts/discoveryBundles'

// a timelock announced the way hodl announces, under a marker of its own
const vault = {
  id: 'example-vault',
  name: 'Example vault',
  find: {
    kind: 'announcement', output: 0, prefix: '6a045641554c', pushes: 3,
    fields: {
      announcedScriptHash: { push: 1, as: 'addressHash' },
      locktime: { push: 2, as: 'utf8int', min: 1 },
    },
  },
  script: {
    template: '<locktime>b17576a9<ownerPkh>88ac', addressType: 'p2sh20',
    fields: { locktime: { as: 'vmnumber' }, ownerPkh: { as: 'hex', bytes: 20 } },
  },
  owner: { kind: 'rebuild', ownerField: 'ownerPkh', matches: 'announcedScriptHash' },
}
const bundle = (contracts: unknown[] = [vault], extra: object = {}) =>
  JSON.stringify({ format: 1, name: 'Example bundle', contracts, ...extra })

function problemOf(json: string, existing = loadDiscoveryBundles()) {
  const read = readBundle(json, existing)
  return 'problem' in read ? read.problem : undefined
}

describe('reading a discovery bundle', () => {
  beforeEach(() => { localStorageMock.clear() })

  it('accepts a bundle of the shape the built-in one has', () => {
    const read = readBundle(bundle(), [])
    expect('bundle' in read && read.bundle.contracts[0]?.id).toBe('example-vault')
  })

  it('refuses what is not a bundle, with the reason', () => {
    expect(problemOf('{ not json')).toEqual({ kind: 'notJson' })
    expect(problemOf(bundle([{ ...vault, find: { ...vault.find, pushes: 0 } }]))).toMatchObject({ kind: 'invalid' })
    expect(problemOf('x'.repeat(100_001))).toEqual({ kind: 'tooLarge' })
  })

  // valid parts that could never find a position are refused when added, not shown as nothing found
  it('refuses a way of finding paired with the wrong proof of ownership', () => {
    const fieldOwner = { ...vault, owner: { kind: 'field', field: 'locktime' } }
    const problem = problemOf(bundle([fieldOwner]))
    expect(problem).toMatchObject({ kind: 'invalid' })
    expect(problem && 'detail' in problem && problem.detail).toContain('rebuilding its script')

    const undeclaredHole = { ...vault, script: { ...vault.script, template: '<locktime>b17576a9<ownerPkh>88<extra>' } }
    expect(ContractManifestSchema.safeParse(undeclaredHole).success).toBe(false)
    const unfilled = { ...vault, script: { ...vault.script, template: '<locktime><other>a9<ownerPkh>88ac', fields: { ...vault.script.fields, other: { as: 'hex' } } } }
    expect(ContractManifestSchema.safeParse(unfilled).success).toBe(false)
  })

  // a position is traced to its manifest by id, and the built-in rows are found by theirs
  it('refuses an id or a name the built-in bundle uses', () => {
    expect(problemOf(bundle([{ ...vault, id: 'hodl-vault' }]))).toEqual({ kind: 'idTaken', name: 'hodl-vault' })
    expect(problemOf(bundle([vault], { name: builtinBundle.name }))).toEqual({ kind: 'nameTaken', name: builtinBundle.name })
  })

  it('refuses a held position, which only the built-in rows can value', () => {
    const held = { id: 'example-held', name: 'Held', find: { kind: 'held', categories: ['ab'.repeat(32)] }, owner: { kind: 'holder' } }
    expect(problemOf(bundle([held]))).toEqual({ kind: 'heldUnsupported' })
  })
})

describe('kept discovery bundles', () => {
  beforeEach(() => { localStorageMock.clear() })
  const parsed = () => (readBundle(bundle(), []) as { bundle: ReturnType<typeof loadDiscoveryBundles>[number] }).bundle

  it('replaces a bundle of the same name, and removes by name', () => {
    saveDiscoveryBundle(parsed())
    expect(saveDiscoveryBundle({ ...parsed(), description: 'again' })).toHaveLength(1)
    expect(loadDiscoveryBundles()[0]?.description).toBe('again')
    expect(deleteDiscoveryBundle('Example bundle')).toEqual([])
  })

  it('drops a stored bundle that no longer passes, rather than running it', () => {
    localStorageMock.setItem('discoveryBundles', JSON.stringify([{ format: 1, name: 'Old', contracts: [{ ...vault, owner: { kind: 'holder' } }] }, JSON.parse(bundle())]))
    expect(loadDiscoveryBundles().map(kept => kept.name)).toEqual(['Example bundle'])
  })

  it('is used only while the developer option is on', () => {
    saveDiscoveryBundle(parsed())
    expect(activeDiscoveryBundles()).toEqual([])
    localStorageMock.setItem('contractDiscovery', 'true')
    expect(activeDiscoveryBundles()).toHaveLength(1)
  })

  it('applies a bundle on the network it names, mainnet when it names none', () => {
    const chipnet = { ...parsed(), name: 'Chipnet bundle', network: 'chipnet' as const, contracts: [{ ...parsed().contracts[0]!, id: 'chipnet-vault' }] }
    const bundles = [parsed(), chipnet]
    expect(discoveryManifests(bundles, 'mainnet').map(entry => entry.manifest.id)).toEqual(['example-vault'])
    expect(discoveryManifests(bundles, 'chipnet').map(entry => entry.bundleName)).toEqual(['Chipnet bundle'])
  })
})
