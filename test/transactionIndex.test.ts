import { beforeEach, describe, expect, it, vi } from 'vitest'
import { binToHex, encodeTransaction, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth'
import type { InOutput, TransactionHistoryItem, TxI } from '@cashonize/bch-wallet-lib'
import { localStorageMock } from './mocks/store.mocks'
import { updateTransactionIndex } from '../src/utils/history/transactionIndex'
import { detectIdentities } from '../src/utils/tools/identityDetection'
import { listingsFromHistory } from '../src/utils/defi/tapswapListings'
import { hodlContractsFromHistory } from '../src/utils/defi/hodlContracts'
import { authGuardLockingBytecodes } from '../src/utils/tools/authGuard'
import { p2pkhBytecode } from './mocks/history.mocks'

// A history in two forms built from one description: the raw transactions the index decodes, and
// the history items the library builds, whose inputs carry the token of the coin they spend
interface Coin { lockingBytecode: string, token?: NonNullable<InOutput['token']> }
interface Spec { hash: string, height: number, inputs: { txid: string, vout: number, token?: Coin['token'] }[], outputs: Coin[] }

const token = (category: string, nft?: { commitment: string, capability?: 'none' | 'mutable' | 'minting' }, amount = 0n) =>
  ({ category, amount, ...(nft ? { nft: { capability: nft.capability ?? 'none', commitment: nft.commitment } } : {}) })
const p2pkh = (coinToken?: Coin['token']): Coin => ({ lockingBytecode: p2pkhBytecode, ...(coinToken ? { token: coinToken } : {}) })
const tx = (byte: string, height: number, inputs: Spec['inputs'], outputs: Coin[]): Spec => ({ hash: byte.repeat(32), height, inputs, outputs })

function rawHex(spec: Spec) {
  return binToHex(encodeTransaction({
    version: 2,
    locktime: 0,
    inputs: spec.inputs.map(input => ({
      outpointTransactionHash: hexToBin(input.txid), outpointIndex: input.vout, sequenceNumber: 0, unlockingBytecode: new Uint8Array(),
    })),
    outputs: spec.outputs.map(output => ({
      lockingBytecode: hexToBin(output.lockingBytecode),
      valueSatoshis: 1000n,
      ...(output.token ? { token: {
        category: hexToBin(output.token.category),
        amount: output.token.amount,
        ...(output.token.nft ? { nft: { capability: output.token.nft.capability, commitment: hexToBin(output.token.nft.commitment) } } : {}),
      } } : {}),
    })),
  }))
}

function address(lockingBytecode: string) {
  if (lockingBytecode.startsWith('6a')) return `OP_RETURN: ${lockingBytecode}`
  const result = lockingBytecodeToCashAddress({ bytecode: hexToBin(lockingBytecode), prefix: 'bitcoincash' })
  return typeof result === 'string' ? `SCRIPT: ${lockingBytecode}` : result.address
}

// the library's history is newest first, which is the order detection reads markers in
const history = (specs: Spec[]) => [...specs].sort((a, b) => b.height - a.height).map(historyItem)

function historyItem(spec: Spec): TransactionHistoryItem {
  return {
    hash: spec.hash, blockHeight: spec.height, size: 0, fee: 0, balance: 0, valueChange: 0, tokenAmountChanges: [],
    inputs: spec.inputs.map(input => ({
      address: 'bitcoincash:qtest', value: 1000, outpointTransactionHash: input.txid, outpointIndex: input.vout,
      ...(input.token ? { token: input.token } : {}),
    })),
    outputs: spec.outputs.map(output => ({ address: address(output.lockingBytecode), value: 1000, lockingBytecode: output.lockingBytecode, ...(output.token ? { token: output.token } : {}) })),
  }
}

// Real mainnet announcements, from the TapSwap and hodl tests
const listingAnnouncement = '6a044d5053570104043d400caf14e4da17ddbe40533c2a8638fdedf2c0997d46e9530300093d000000148ee26d6c9f58369f94864dc3630cdeb17fae2f2d03c0d401'
const listingContract = `a914${'33'.repeat(20)}87`
const hodlAnnouncement = '6a04686f646c36626974636f696e636173683a707068307878357563386c7068756a6d73726a7965683565737963667a63337776356572737565766e3906383836363632'
const ownerPkh = '8ee26d6c9f58369f94864dc3630cdeb17fae2f2d'

const A = 'a1'.repeat(32), G = 'a2'.repeat(32), L1 = 'a3'.repeat(32)
const B = 'b1'.repeat(32), GB = 'b2'.repeat(32), KT = 'b3'.repeat(32), LB = 'b4'.repeat(32)
const keyCategory = 'c0'.repeat(32)
const covenant = authGuardLockingBytecodes(keyCategory).p2sh20
const authKey = token(keyCategory, { commitment: '' })

function fixture(): Spec[] {
  const fillers = Array.from({ length: 20 }, (_, index) =>
    tx((index + 16).toString(16), 900 + index, [{ txid: 'ff'.repeat(32), vout: index + 1 }], [p2pkh()]))
  return [
    ...fillers,
    // a genesis these keys made, and a send that took its output 0 on
    tx('a1', 1000, [{ txid: 'fe'.repeat(32), vout: 1 }], [p2pkh()]),
    tx('a2', 1001, [{ txid: A, vout: 0 }], [p2pkh(token(A, undefined, 1000n))]),
    tx('a3', 1002, [{ txid: G, vout: 0, token: token(A, undefined, 1000n) }], [p2pkh()]),
    // a genesis into an AuthGuard, and the update its AuthKey opened it for
    tx('b1', 1003, [{ txid: 'fd'.repeat(32), vout: 1 }], [p2pkh()]),
    tx('b2', 1004, [{ txid: B, vout: 0 }], [{ lockingBytecode: covenant, token: token(B, undefined, 5n) }]),
    tx('b3', 1004, [{ txid: 'fc'.repeat(32), vout: 1 }], [p2pkh(authKey)]),
    tx('b4', 1005, [{ txid: GB, vout: 0, token: token(B, undefined, 5n) }, { txid: KT, vout: 0, token: authKey }],
      [{ lockingBytecode: covenant, token: token(B, undefined, 5n) }, p2pkh(authKey)]),
    // a publication of an identity received from elsewhere
    tx('d1', 1006, [{ txid: 'fb'.repeat(32), vout: 0 }], [p2pkh(), { lockingBytecode: `6a0442434d5220${'11'.repeat(32)}` }]),
    // a TapSwap listing and a hodl contract funded here
    tx('d2', 1007, [{ txid: 'fa'.repeat(32), vout: 1 }], [
      { lockingBytecode: listingContract, token: token('77'.repeat(32), { commitment: 'd300' }) }, { lockingBytecode: listingAnnouncement },
    ]),
    tx('d3', 1008, [{ txid: 'f9'.repeat(32), vout: 1 }], [{ lockingBytecode: hodlAnnouncement }, p2pkh()]),
  ]
}

function walletOver(specs: Spec[]) {
  const hexes = new Map(specs.map(spec => [spec.hash, rawHex(spec)]))
  const requested: string[] = []
  return {
    requested,
    wallet: {
      getRawHistory: vi.fn((): Promise<TxI[]> => Promise.resolve(specs.map(spec => ({ tx_hash: spec.hash, height: spec.height })))),
      provider: {
        getRawTransactions: vi.fn((hashes: string[]) => {
          requested.push(...hashes)
          return Promise.resolve(new Map(hashes.map(hash => [hash, hexes.get(hash)!])))
        }),
      },
    },
  }
}

describe('transaction index', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  // what the features find in the kept transactions must be what they found in the whole history
  it('finds what the whole history shows', async () => {
    const specs = fixture()
    const items = history(specs)
    const { wallet } = walletOver(specs)

    const index = await updateTransactionIndex(wallet, 'mainnet', 'w')

    const fromHistory = detectIdentities(items)
    expect(fromHistory.identities.map(identity => identity.authheadTxid).sort()).toEqual([L1, LB, 'd1'.repeat(32)].sort())
    expect(detectIdentities(index.identityChain, index.historyTxids)).toEqual(fromHistory)
    expect(listingsFromHistory(index.announcements, [ownerPkh], 'bitcoincash')).toEqual(listingsFromHistory(items, [ownerPkh], 'bitcoincash'))
    expect(listingsFromHistory(items, [ownerPkh], 'bitcoincash')).toHaveLength(1)
    expect(hodlContractsFromHistory(index.announcements, [ownerPkh])).toEqual(hodlContractsFromHistory(items, [ownerPkh]))
    expect(hodlContractsFromHistory(items, [ownerPkh])).toHaveLength(1)
  })

  // a metadata update through an AuthGuard publishes, so it is kept as a marker, and the walk out of
  // the guard still needs the AuthKey its input 1 carries
  it('follows a chain through a publishing AuthGuard spend', async () => {
    const specs = [
      tx('b1', 1003, [{ txid: 'fd'.repeat(32), vout: 1 }], [p2pkh()]),
      tx('b2', 1004, [{ txid: B, vout: 0 }], [{ lockingBytecode: covenant }, p2pkh(token(B, undefined, 5n))]),
      tx('b3', 1004, [{ txid: 'fc'.repeat(32), vout: 1 }], [p2pkh(authKey)]),
      tx('b4', 1005, [{ txid: GB, vout: 0 }, { txid: KT, vout: 0, token: authKey }],
        [{ lockingBytecode: covenant }, p2pkh(authKey), { lockingBytecode: `6a0442434d5220${'33'.repeat(32)}` }]),
      tx('b5', 1006, [{ txid: LB, vout: 0 }, { txid: LB, vout: 1, token: authKey }], [p2pkh(), p2pkh(authKey)]),
    ]

    const index = await updateTransactionIndex(walletOver(specs).wallet, 'mainnet', 'w')

    const detected = detectIdentities(index.identityChain, index.historyTxids)
    expect(detected.identities).toContainEqual({ authheadTxid: 'b5'.repeat(32), category: B, marker: 'genesis' })
    expect(detected).toEqual(detectIdentities(history(specs)))
  })

  it('decodes only what is new on the next update, and follows a chain into it', async () => {
    const specs = fixture()
    await updateTransactionIndex(walletOver(specs).wallet, 'mainnet', 'w')

    const L2 = 'a4'.repeat(32)
    const next = [...specs, tx('a4', 1020, [{ txid: L1, vout: 0 }], [p2pkh()])]
    const { wallet, requested } = walletOver(next)
    const index = await updateTransactionIndex(wallet, 'mainnet', 'w')

    const fillers = specs.filter(spec => spec.height < 1000).map(spec => spec.hash)
    expect(requested.some(hash => fillers.includes(hash))).toBe(false)
    expect(detectIdentities(index.identityChain, index.historyTxids)).toEqual(detectIdentities(history(next)))
    expect(detectIdentities(index.identityChain, index.historyTxids).identities.map(identity => identity.authheadTxid)).toContain(L2)
  })

  it('drops a kept transaction the history no longer has', async () => {
    const specs = fixture()
    await updateTransactionIndex(walletOver(specs).wallet, 'mainnet', 'w')

    const index = await updateTransactionIndex(walletOver(specs.filter(spec => spec.hash !== 'd1'.repeat(32))).wallet, 'mainnet', 'w')

    expect(index.identityChain.map(transaction => transaction.hash)).not.toContain('d1'.repeat(32))
  })

  // e.g. an HD wallet finding an address used long ago: its transactions sit below the last scan
  it('scans everything again when old transactions appear', async () => {
    const specs = fixture()
    await updateTransactionIndex(walletOver(specs).wallet, 'mainnet', 'w')

    const old = tx('e1', 950, [{ txid: 'f8'.repeat(32), vout: 0 }], [p2pkh(), { lockingBytecode: `6a0442434d5220${'22'.repeat(32)}` }])
    const index = await updateTransactionIndex(walletOver([...specs, old]).wallet, 'mainnet', 'w')

    expect(index.identityChain.map(transaction => transaction.hash)).toContain(old.hash)
  })

  // a wallet that minted thousands from its authhead would crowd its reservations out of localStorage
  it('keeps no index over the size cap, and no stale copy of it', async () => {
    const E = 'e1'.repeat(32)
    const linkHash = (index: number) => index.toString(16).padStart(8, '0').repeat(8)
    const specs = [
      tx('e1', 1000, [{ txid: 'f8'.repeat(32), vout: 1 }], [p2pkh()]),
      tx('e2', 1001, [{ txid: E, vout: 0 }], [p2pkh(token(E, undefined, 1000n))]),
      ...Array.from({ length: 3000 }, (_, index) => ({
        hash: linkHash(index + 1), height: 1002 + index,
        inputs: [{ txid: index === 0 ? 'e2'.repeat(32) : linkHash(index), vout: 0 }], outputs: [p2pkh()],
      })),
    ]
    localStorageMock.setItem('transactionIndex-mainnet-w', '{"version":3}')

    const index = await updateTransactionIndex(walletOver(specs).wallet, 'mainnet', 'w')

    expect(index.identityChain.length).toBeGreaterThan(3000)
    expect(localStorageMock.getItem('transactionIndex-mainnet-w')).toBeNull()
  })
})
