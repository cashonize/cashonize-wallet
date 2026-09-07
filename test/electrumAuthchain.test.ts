import { describe, expect, it, vi } from 'vitest'
import {
  binToHex,
  hexToBin,
  encodeTransaction,
  hashTransaction,
  lockingBytecodeToCashAddress,
  CashAddressNetworkPrefix,
  type TransactionCommon,
} from '@bitauth/libauth'
import type { TxI } from 'mainnet-js'
import { resolveAuthHeadsElectrum, queryAuthchainLinksElectrum, ELECTRUM_WALK_LIMIT } from '../src/utils/tools/electrumAuthchain'

// A chain of three real transactions: the authbase paying a first address, the genesis spending
// its output 0 and minting the token with a key at output 1 and a publication, and a transfer
// moving the identity output on. Every link is encoded, so the walk decodes what a server serves.
const p2pkh = (byte: string) => hexToBin('76a914' + byte.repeat(20) + '88ac')
const addressOf = (bytecode: Uint8Array) => {
  const decoded = lockingBytecodeToCashAddress({ bytecode, prefix: 'bitcoincash' })
  if (typeof decoded === 'string') throw new Error(decoded)
  return decoded.address
}
const publicationBytecode = hexToBin(`6a0442434d5220${'11'.repeat(32)}0b6578616d706c652e636f6d`)

function transaction(inputs: { txid: string, vout: number }[], outputs: TransactionCommon['outputs']): TransactionCommon {
  return {
    version: 2,
    locktime: 0,
    inputs: inputs.map(({ txid, vout }) => ({
      outpointTransactionHash: hexToBin(txid),
      outpointIndex: vout,
      sequenceNumber: 0,
      unlockingBytecode: new Uint8Array(),
    })),
    outputs,
  }
}
const txidOf = (tx: TransactionCommon) => hashTransaction(encodeTransaction(tx))

const authbase = transaction([{ txid: 'ff'.repeat(32), vout: 0 }], [
  { lockingBytecode: p2pkh('01'), valueSatoshis: 10_000n },
  { lockingBytecode: p2pkh('09'), valueSatoshis: 5_000n },
])
const category = txidOf(authbase)
const genesis = transaction([{ txid: category, vout: 0 }], [
  { lockingBytecode: p2pkh('02'), valueSatoshis: 1_000n, token: { category: hexToBin(category), amount: 1_000n } },
  { lockingBytecode: p2pkh('02'), valueSatoshis: 1_000n, token: { category: hexToBin(category), amount: 0n, nft: { capability: 'none', commitment: hexToBin('ab') } } },
  { lockingBytecode: publicationBytecode, valueSatoshis: 0n },
  { lockingBytecode: p2pkh('01'), valueSatoshis: 7_000n },
])
const genesisTxid = txidOf(genesis)
const transfer = transaction([{ txid: genesisTxid, vout: 0 }], [
  { lockingBytecode: p2pkh('03'), valueSatoshis: 1_000n, token: { category: hexToBin(category), amount: 1_000n } },
])
const transferTxid = txidOf(transfer)

// An electrum provider serving the chain: raw transactions by hash, each address's history with
// heights the way Fulcrum reports them, and the outputs nothing has spent
function fakeProvider(
  transactions: Record<string, TransactionCommon>,
  histories: Record<string, TxI[]>,
  timestamps: Record<number, number> = {},
  unspent: { txid: string, address: string, height: number }[] = [{ txid: transferTxid, address: addressOf(p2pkh('03')), height: 800_020 }],
) {
  return {
    getRawTransactions: vi.fn((hashes: string[]) => Promise.resolve(new Map(
      hashes.filter(hash => transactions[hash]).map(hash => [hash, binToHex(encodeTransaction(transactions[hash]!))])
    ))),
    getHistory: vi.fn((address: string) => Promise.resolve(histories[address] ?? [])),
    getUtxos: vi.fn((address: string) => Promise.resolve(
      unspent.filter(utxo => utxo.address === address).map(utxo => ({ txid: utxo.txid, vout: 0, satoshis: 1_000n, address, height: utxo.height }))
    )),
    getHeaders: vi.fn((heights: number[]) => Promise.resolve(new Map(
      heights.filter(height => timestamps[height]).map(height => [height, { timestamp: timestamps[height] }])
    ))),
  }
}

const chain = {
  [category]: authbase,
  [genesisTxid]: genesis,
  [transferTxid]: transfer,
}
const chainHistories = {
  [addressOf(p2pkh('01'))]: [{ tx_hash: category, height: 800_000 }, { tx_hash: genesisTxid, height: 800_010 }],
  [addressOf(p2pkh('02'))]: [{ tx_hash: genesisTxid, height: 800_010 }, { tx_hash: transferTxid, height: 800_020 }],
  [addressOf(p2pkh('03'))]: [{ tx_hash: transferTxid, height: 800_020 }],
}

describe('resolveAuthHeadsElectrum', () => {
  it('walks the chain to its authhead and reads what Chaingraph would report', async () => {
    const provider = fakeProvider(chain, chainHistories, { 800_010: 1_700_000_000 })

    const result = (await resolveAuthHeadsElectrum([category], provider as never, CashAddressNetworkPrefix.mainnet, 200)).get(category)

    expect(result).toEqual({
      txid: transferTxid,
      identityOutput: {
        lockingBytecode: binToHex(p2pkh('03')),
        satoshis: 1_000n,
        token: { category, amount: 1_000n },
      },
      publicationOutputs: [binToHex(publicationBytecode)],
      publicationTimestamp: 1_700_000_000,
      chainLength: 3,
      recentLinks: [category, genesisTxid, transferTxid],
      isToken: true,
      fungibleSupply: true,
      genesisSupply: 1_000n,
      keyCommitment: 'ab',
    })
  })

  // proving nothing spent an output would mean reading its address's whole history, so the
  // unspent check comes first and the history is read only for a spent link
  it('asks one history per spent link and none for the authhead', async () => {
    const provider = fakeProvider(chain, chainHistories)

    await resolveAuthHeadsElectrum([category], provider as never, CashAddressNetworkPrefix.mainnet, 0)

    expect(provider.getUtxos).toHaveBeenCalledTimes(3)
    expect(provider.getHistory.mock.calls.map(([address]) => address)).toEqual([
      addressOf(p2pkh('01')), addressOf(p2pkh('02')),
    ])
  })

  // the output's own transaction and anything mined before it cannot have spent it
  it('looks for the spender only among transactions from the link on, oldest first', async () => {
    const unrelatedEarlier = transaction([{ txid: 'ee'.repeat(32), vout: 0 }], [{ lockingBytecode: p2pkh('01'), valueSatoshis: 1n }])
    const busyHistories = {
      ...chainHistories,
      [addressOf(p2pkh('01'))]: [
        { tx_hash: txidOf(unrelatedEarlier), height: 700_000 },
        { tx_hash: genesisTxid, height: 800_010 },
        { tx_hash: category, height: 800_000 },
      ],
    }
    const provider = fakeProvider({ ...chain, [txidOf(unrelatedEarlier)]: unrelatedEarlier }, busyHistories)

    const result = (await resolveAuthHeadsElectrum([category], provider as never, CashAddressNetworkPrefix.mainnet, 0)).get(category)

    expect(result?.txid).toBe(transferTxid)
    // the first fetch is the authbase itself; the search fetches only the genesis
    expect(provider.getRawTransactions.mock.calls[1]?.[0]).toEqual([genesisTxid])
  })

  it('reports an identity still at its authbase as a chain of one', async () => {
    const provider = fakeProvider({ [category]: authbase }, {}, {}, [{ txid: category, address: addressOf(p2pkh('01')), height: 800_000 }])

    const result = (await resolveAuthHeadsElectrum([category], provider as never, CashAddressNetworkPrefix.mainnet, 200)).get(category)

    expect(result?.txid).toBe(category)
    expect(result?.chainLength).toBe(1)
    expect(result?.isToken).toBe(false)
    expect(result?.publicationOutputs).toEqual([])
  })

  it('ends the chain at an OP_RETURN identity output without asking about it', async () => {
    const burn = transaction([{ txid: genesisTxid, vout: 0 }], [{ lockingBytecode: hexToBin('6a04deadbeef'), valueSatoshis: 0n }])
    const burnTxid = txidOf(burn)
    const provider = fakeProvider({ ...chain, [burnTxid]: burn }, {
      ...chainHistories,
      [addressOf(p2pkh('02'))]: [{ tx_hash: genesisTxid, height: 800_010 }, { tx_hash: burnTxid, height: 800_020 }],
    })

    const result = (await resolveAuthHeadsElectrum([category], provider as never, CashAddressNetworkPrefix.mainnet, 0)).get(category)

    expect(result?.txid).toBe(burnTxid)
    expect(result?.identityOutput?.lockingBytecode).toBe('6a04deadbeef')
    expect(provider.getUtxos).toHaveBeenCalledTimes(2)
  })

  // a chain still spent at the cap is one the walk cannot finish: unresolved, never a link that
  // is not the head, since that coin would then be held back as the identity
  it('gives up on a chain longer than the walk goes rather than answer short', async () => {
    const transactions: Record<string, TransactionCommon> = { [category]: authbase }
    const histories: Record<string, TxI[]> = {}
    let previous = { txid: category, tx: authbase }
    for (let index = 1; index <= ELECTRUM_WALK_LIMIT + 1; index++) {
      const link = transaction([{ txid: previous.txid, vout: 0 }], [{ lockingBytecode: p2pkh((0x10 + index).toString(16)), valueSatoshis: 1_000n }])
      const txid = txidOf(link)
      transactions[txid] = link
      const previousAddress = addressOf(previous.tx.outputs[0]!.lockingBytecode)
      histories[previousAddress] = [{ tx_hash: previous.txid, height: 800_000 + index }, { tx_hash: txid, height: 800_001 + index }]
      previous = { txid, tx: link }
    }
    const provider = fakeProvider(transactions, histories, {}, [{ txid: previous.txid, address: addressOf(previous.tx.outputs[0]!.lockingBytecode), height: 900_000 }])

    const results = await resolveAuthHeadsElectrum([category], provider as never, CashAddressNetworkPrefix.mainnet, 0)

    expect(results.size).toBe(0)
    expect(provider.getHistory).toHaveBeenCalledTimes(ELECTRUM_WALK_LIMIT - 1)
  })

  it('leaves out a category whose chain cannot be walked, keeping the rest', async () => {
    const provider = fakeProvider(chain, chainHistories)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const results = await resolveAuthHeadsElectrum(['00'.repeat(32), category], provider as never, CashAddressNetworkPrefix.mainnet, 0)

    expect([...results.keys()]).toEqual([category])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  // the wait is the longest chain's rather than the sum, but never more than a few at once
  it('walks a few chains at a time', async () => {
    let inFlight = 0
    let mostInFlight = 0
    const provider = fakeProvider(chain, chainHistories)
    provider.getUtxos.mockImplementation(async (address: string) => {
      inFlight++
      mostInFlight = Math.max(mostInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight--
      return address === addressOf(p2pkh('03')) ? [{ txid: transferTxid, vout: 0, satoshis: 1_000n, address, height: 800_020 }] : []
    })

    const results = await resolveAuthHeadsElectrum(Array(16).fill(category), provider as never, CashAddressNetworkPrefix.mainnet, 0)

    expect(results.get(category)?.txid).toBe(transferTxid)
    expect(mostInFlight).toBeGreaterThan(1)
    expect(mostInFlight).toBeLessThanOrEqual(10)
  })
})

describe('queryAuthchainLinksElectrum', () => {
  it('returns every link with its outputs in the shape of the Chaingraph links query', async () => {
    const provider = fakeProvider(chain, chainHistories, { 800_000: 1, 800_010: 2, 800_020: 3 })

    const links = await queryAuthchainLinksElectrum(category, provider as never, CashAddressNetworkPrefix.mainnet)

    expect(links.map(link => link.hash)).toEqual([category, genesisTxid, transferTxid])
    expect(links.map(link => link.timestamp)).toEqual([1, 2, 3])
    expect(links[1]?.outputs[0]).toEqual({
      output_index: '0',
      locking_bytecode: `\\x${binToHex(p2pkh('02'))}`,
      token_category: `\\x${category}`,
      fungible_token_amount: '1000',
    })
    expect(links[0]?.outputs[0]?.token_category).toBeNull()
  })
})
