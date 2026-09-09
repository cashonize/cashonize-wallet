import { describe, expect, it, vi } from 'vitest'
import { binToHex, utf8ToBin } from '@bitauth/libauth'
import type { ElectrumNetworkProvider, TransactionHistoryItem, Utxo } from 'mainnet-js'

import builtinContracts from '../src/utils/contracts/builtinContracts.json'
import { ContractBundleSchema, buildScript } from '../src/utils/contracts/contractManifest'
import { contractAddress } from '../src/utils/contracts/redeemScript'
import { runManifest } from '../src/utils/contracts/runManifest'
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

// These assert what badgersStake.ts and hodlContracts.ts asserted before the manifests replaced
// them, against the same real announcements their own tests used.
describe('badgers-stake', () => {
  it('finds the lock this wallet owns and reads its stake length', async () => {
    const utxos = [lockUtxo(ownerPkh, 160, 500_000n, 800_000), lockUtxo(stranger, 20, 900_000n, 800_001)]
    const provider = providerFor({ [badgersAddress]: utxos })

    const positions = await runManifest(badgers, context(provider))

    expect(positions).toHaveLength(1)
    expect(positions[0]?.satoshis).toBe(500_000n)
    expect(positions[0]?.confirmedAtHeight).toBe(800_000)
    expect(positions[0]?.fields.stakeBlocks).toBe(160)
    expect(positions[0]?.ownership).toBe('encumbered')
  })

  it('leaves a lock belonging to another wallet alone', async () => {
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

describe('hodl-vault', () => {
  it('finds the announced contract and what it holds now', async () => {
    const { address, history } = hodlSetup(800_000, ownerPkh)
    const provider = providerFor({ [address]: [{ txid: 'ef'.repeat(32), vout: 0, satoshis: 1_000_000n, address }] })

    const positions = await runManifest(hodl, context(provider, history))

    expect(positions).toHaveLength(1)
    expect(positions[0]?.address).toBe(address)
    expect(positions[0]?.satoshis).toBe(1_000_000n)
    expect(positions[0]?.fields.locktime).toBe(800_000)
  })

  // funding a contract does not imply owning it, so the rebuild is the whole of the rule
  it('does not claim a contract another key announced', async () => {
    const { address, history } = hodlSetup(800_000, stranger)
    const provider = providerFor({ [address]: [{ txid: 'ef'.repeat(32), vout: 0, satoshis: 1_000_000n, address }] })

    expect(await runManifest(hodl, context(provider, history))).toEqual([])
  })

  // a drained contract holds nothing, which the announcement cannot say
  it('drops a contract that has been emptied', async () => {
    const { address, history } = hodlSetup(800_000, ownerPkh)
    const provider = providerFor({ [address]: [] })

    expect(await runManifest(hodl, context(provider, history))).toEqual([])
  })

  // A real mainnet announcement writing its address as a legacy base58 string. Comparing the
  // rendered address would never match this; comparing the hash it commits to does.
  it('finds a contract announced with a legacy address', async () => {
    const legacy = '6a04686f646c243332636757766b314b34326262333232695379784572514c43657453736f72637943203106373135353537'
    const legacyOwner = 'edaab961e6daaa47574fc875b67d9e5c88d4a9a6'
    const address = 'bitcoincash:pq9zvsh6622zhjvvdckynx2st3759f8m7qt8yg06z9'
    const history: TransactionHistoryItem[] = [historyItem('ba'.repeat(32), [opReturnOutput(legacy), p2pkhOutput()])]
    const provider = providerFor({ [address]: [{ txid: 'ef'.repeat(32), vout: 0, satoshis: 750_000n, address }] })

    const positions = await runManifest(hodl, { provider, ownerPkhs: [legacyOwner], history, networkPrefix: 'bitcoincash' })

    expect(positions).toHaveLength(1)
    expect(positions[0]?.satoshis).toBe(750_000n)
    expect(positions[0]?.fields.locktime).toBe(715_557)
  })

  // the manifest names the output its announcement sits at, so one anywhere else is not it
  it('ignores an announcement at an output the manifest does not name', async () => {
    const { address, history } = hodlSetup(800_000, ownerPkh)
    const announcement = history[0]!.outputs[0]!
    const moved = [historyItem('ba'.repeat(32), [p2pkhOutput(), announcement])]
    const provider = providerFor({ [address]: [{ txid: 'ef'.repeat(32), vout: 0, satoshis: 1n, address }] })

    expect(await runManifest(hodl, context(provider, moved))).toEqual([])
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
