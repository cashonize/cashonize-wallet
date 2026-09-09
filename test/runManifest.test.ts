import { describe, expect, it, vi } from 'vitest'
import { binToHex, utf8ToBin } from '@bitauth/libauth'
import type { ElectrumNetworkProvider, TransactionHistoryItem, Utxo } from 'mainnet-js'

import builtinContracts from '../src/utils/contracts/builtinContracts.json'
import { ContractBundleSchema, buildScript } from '../src/utils/contracts/contractManifest'
import { contractAddress } from '../src/utils/contracts/redeemScript'
import { runManifest } from '../src/utils/contracts/runManifest'
import { fetchBadgerLocks } from '../src/utils/defi/badgersStake'
import { hodlContractsFromHistory, fetchHodlContractStates } from '../src/utils/defi/hodlContracts'
import { historyItem, opReturnOutput, p2pkhOutput } from './mocks/history.mocks'

const bundle = ContractBundleSchema.parse(builtinContracts)
const badgers = bundle.contracts.find(contract => contract.id === 'badgers-stake')!
const hodl = bundle.contracts.find(contract => contract.id === 'hodl-vault')!

const ownerPkh = '8ee26d6c9f58369f94864dc3630cdeb17fae2f2d'
const stranger = 'ff'.repeat(20)
const badgersAddress = badgers.find.kind === 'address' ? badgers.find.address : ''
const badgercoin = '242f6ecedb404c743477e35b09733a56cacae34f3109d5cee1cbc1d5630affd7'
const push = (bytes: Uint8Array) => binToHex(Uint8Array.from([bytes.length, ...bytes]))

const lockUtxo = (pkh: string, stakeBlocks: number, satoshis: bigint, height?: number): Utxo => ({
  txid: 'ab'.repeat(32), vout: 0, satoshis, address: badgersAddress,
  ...(height ? { height } : {}),
  token: {
    category: badgercoin, amount: 0n,
    nft: { capability: 'mutable', commitment: pkh + '00'.repeat(18) + binToHex(Uint8Array.from([stakeBlocks & 0xff, stakeBlocks >> 8])) },
  },
})

function spyFor(utxosByAddress: Record<string, Utxo[]>) {
  return vi.fn((address: string) => Promise.resolve(utxosByAddress[address] ?? []))
}

function providerFor(utxosByAddress: Record<string, Utxo[]>) {
  return { getUtxos: spyFor(utxosByAddress) } as unknown as ElectrumNetworkProvider
}

function hodlSetup(locktime: number, pkh: string) {
  const script = buildScript(hodl.script!, { locktime, ownerPkh: pkh })!
  const address = contractAddress(script, 'p2sh20', 'bitcoincash')!
  const opReturn = '6a04686f646c' + push(utf8ToBin(address)) + push(utf8ToBin(String(locktime)))
  const history: TransactionHistoryItem[] = [historyItem('cd'.repeat(32), [opReturnOutput(opReturn), p2pkhOutput()])]
  return { address, history }
}

const context = (provider: ElectrumNetworkProvider, history: TransactionHistoryItem[] = []) =>
  ({ provider, ownerPkhs: [ownerPkh], history, networkPrefix: 'bitcoincash' })

// The point of the manifest is that it finds what the hand-written module finds. These run both
// over the same inputs and compare, which is the check that the description is faithful.
describe('badgers-stake, against badgersStake.ts', () => {
  it('finds the same locks the module finds', async () => {
    const utxos = [lockUtxo(ownerPkh, 160, 500_000n, 800_000), lockUtxo(stranger, 20, 900_000n, 800_001)]
    const provider = providerFor({ [badgersAddress]: utxos })

    const positions = await runManifest(badgers, context(provider))
    const fromModule = await fetchBadgerLocks(provider, [ownerPkh])

    expect(positions).toHaveLength(1)
    expect(fromModule).toHaveLength(1)
    expect(positions[0]?.satoshis).toBe(fromModule[0]?.satoshis)
    expect(positions[0]?.confirmedAtHeight).toBe(fromModule[0]?.confirmedAtHeight)
    expect(positions[0]?.fields.stakeBlocks).toBe(fromModule[0]?.stakeBlocks)
    expect(positions[0]?.ownership).toBe('encumbered')
  })

  it('leaves a stranger"s lock alone', async () => {
    const provider = providerFor({ [badgersAddress]: [lockUtxo(stranger, 20, 900_000n, 800_001)] })

    expect(await runManifest(badgers, context(provider))).toEqual([])
  })

  // the contract's own administrative coin is a minting NFT, and only a mutable one is a lock
  it('ignores a coin of the wrong capability', async () => {
    const utxo = lockUtxo(ownerPkh, 160, 500_000n, 800_000)
    utxo.token!.nft!.capability = 'minting'
    const provider = providerFor({ [badgersAddress]: [utxo] })

    expect(await runManifest(badgers, context(provider))).toEqual([])
  })
})

describe('hodl-vault, against hodlContracts.ts', () => {
  it('finds the same contract the module finds', async () => {
    const { address, history } = hodlSetup(800_000, ownerPkh)
    const provider = providerFor({ [address]: [{ txid: 'ef'.repeat(32), vout: 0, satoshis: 1_000_000n, address }] })

    const positions = await runManifest(hodl, context(provider, history))
    const fromModule = await fetchHodlContractStates(provider, hodlContractsFromHistory(history, [ownerPkh]))

    expect(positions).toHaveLength(1)
    expect(positions[0]?.address).toBe(address)
    expect(positions[0]?.satoshis).toBe(fromModule[0]?.satoshis)
    expect(positions[0]?.fields.locktime).toBe(fromModule[0]?.locktime)
  })

  // funding a contract does not imply owning it, so the rebuild is the whole of the rule
  it('does not claim a contract another key announced', async () => {
    const { address, history } = hodlSetup(800_000, stranger)
    const provider = providerFor({ [address]: [{ txid: 'ef'.repeat(32), vout: 0, satoshis: 1_000_000n, address }] })

    expect(await runManifest(hodl, context(provider, history))).toEqual([])
    expect(hodlContractsFromHistory(history, [ownerPkh])).toEqual([])
  })

  // a drained contract holds nothing, which the announcement cannot say
  it('drops a contract that has been emptied, as the module does', async () => {
    const { address, history } = hodlSetup(800_000, ownerPkh)
    const provider = providerFor({ [address]: [] })

    expect(await runManifest(hodl, context(provider, history))).toEqual([])
    expect(await fetchHodlContractStates(provider, hodlContractsFromHistory(history, [ownerPkh]))).toEqual([])
  })

  it('announces the same contract twice without looking it up twice', async () => {
    const { address, history } = hodlSetup(800_000, ownerPkh)
    const getUtxos = spyFor({ [address]: [{ txid: 'ef'.repeat(32), vout: 0, satoshis: 1_000_000n, address }] })
    const provider = { getUtxos } as unknown as ElectrumNetworkProvider

    const positions = await runManifest(hodl, context(provider, [...history, ...history]))

    expect(positions).toHaveLength(1)
    expect(getUtxos).toHaveBeenCalledTimes(1)
  })
})
