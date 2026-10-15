import { describe, expect, it, vi } from 'vitest'
import type { ElectrumNetworkProvider, Utxo } from 'mainnet-js'

import builtinContracts from '../src/utils/contracts/builtinContracts.json'
import { ContractBundleSchema } from '../src/utils/contracts/contractManifest'
import { runManifest } from '../src/utils/contracts/runManifest'
import { LIQUIDITY_POOL_MANIFESTS } from '../src/utils/contracts/builtins'

const bundle = ContractBundleSchema.parse(builtinContracts)
const manifest = (id: string) => bundle.contracts.find(contract => contract.id === id)!

const tokenCategory = 'b'.repeat(64)
const poolUtxo = (address: string, vout: number, token?: Utxo['token']): Utxo => ({
  txid: 'ab'.repeat(32), vout, satoshis: 100_000_000n, address, height: 900_000,
  ...(token ? { token } : {}),
})

function providerFor(utxosByAddress: Record<string, Utxo[]>) {
  const getUtxos = vi.fn((address: string) => Promise.resolve(utxosByAddress[address] ?? []))
  return { provider: { getUtxos } as unknown as ElectrumNetworkProvider, getUtxos }
}

const context = (provider: ElectrumNetworkProvider, ownerPkhs: string[]) =>
  ({ provider, ownerPkhs, history: [], networkPrefix: 'bitcoincash' })

describe('cauldron-pool', () => {
  const ownerPkh = '8ee26d6c9f58369f94864dc3630cdeb17fae2f2d'
  // the address cauldronPools.ts derived for this owner before the manifest replaced it
  const poolAddress = 'bitcoincash:rwtahx7t370gqcuc6lkmcm9dugveqv5rvllgk3pve8u7nvajq6m66jquyahcs'

  it('looks up the address the replaced module derived, and keeps only fungible-token coins', async () => {
    const { provider } = providerFor({ [poolAddress]: [
      poolUtxo(poolAddress, 0, { category: tokenCategory, amount: 500n }),
      // a plain BCH payment to the pool address is not a pool
      poolUtxo(poolAddress, 1),
      poolUtxo(poolAddress, 2, { category: tokenCategory, amount: 0n, nft: { capability: 'none', commitment: '' } }),
    ] })

    const positions = await runManifest(manifest('cauldron-pool'), context(provider, [ownerPkh]))

    expect(positions).toHaveLength(1)
    expect(positions[0]?.address).toBe(poolAddress)
    expect(positions[0]?.vout).toBe(0)
    expect(positions[0]?.token?.amount).toBe(500n)
    expect(positions[0]?.fields.ownerPkh).toBe(ownerPkh)
  })

  it('skips a failed lookup without hiding the pools of the other keys', async () => {
    const getUtxos = vi.fn((address: string) => address === poolAddress
      ? Promise.resolve([poolUtxo(poolAddress, 0, { category: tokenCategory, amount: 500n })])
      : Promise.reject(new Error('unreachable')))
    const provider = { getUtxos } as unknown as ElectrumNetworkProvider
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const positions = await runManifest(manifest('cauldron-pool'), context(provider, ['ff'.repeat(20), ownerPkh]))

    expect(positions).toHaveLength(1)
  })
})

describe('guanaco pools', () => {
  // Real mainnet pool: output 0 of d614bdd2d9685d2aaac0f031e97a8cafa876cbfb1dc1c0b48cce223ab88ae74b,
  // a 0.3% pool validated independently by Guanaco's own parser
  const creatorPkh = '05e59acd98fa3841cac61a1b45c73b0977275025'
  const poolAddress = 'bitcoincash:rdgdcgz3ylaz4807cetg3jquatj9f4vcx6r029exan69z9pep4n7s8yzccc6e'

  it('finds the deployed pool under its own fee tier only', async () => {
    const { provider } = providerFor({ [poolAddress]: [poolUtxo(poolAddress, 0, { category: tokenCategory, amount: 411_490n })] })

    const guanacoIds = LIQUIDITY_POOL_MANIFESTS.filter(id => id.startsWith('guanaco'))
    const found: Record<string, number> = {}
    for (const id of guanacoIds) {
      found[id] = (await runManifest(manifest(id), context(provider, [creatorPkh]))).length
    }

    expect(found).toEqual({ 'guanaco-pool-1bp': 0, 'guanaco-pool-5bp': 0, 'guanaco-pool-30bp': 1, 'guanaco-pool-100bp': 0 })
  })

  it('does not find a pool for a different creator', async () => {
    const { provider, getUtxos } = providerFor({ [poolAddress]: [poolUtxo(poolAddress, 0, { category: tokenCategory, amount: 1n })] })

    expect(await runManifest(manifest('guanaco-pool-30bp'), context(provider, ['06' + creatorPkh.slice(2)]))).toEqual([])
    expect(getUtxos).toHaveBeenCalledTimes(1)
  })
})
