import { describe, it, expect } from 'vitest'
import { binToHex, encodeTransaction, hexToBin, type Output, type Transaction } from '@bitauth/libauth'
import type { WcSourceOutput } from '@bch-wc2/interfaces'
import { scriptDisplay, summarizeDappTransaction } from '../src/utils/dapp/txSummary'

const p2pkh = (byte: string) => hexToBin(`76a914${byte.repeat(20)}88ac`)
const wallet = p2pkh('11')
const payee = p2pkh('22')
const thirdParty = p2pkh('33')
const isWallet = (lockingBytecode: Uint8Array) => binToHex(lockingBytecode) === binToHex(wallet)

const categoryA = hexToBin('aa'.repeat(32))
const categoryB = hexToBin('bb'.repeat(32))

function coin(lockingBytecode: Uint8Array, valueSatoshis: bigint, token?: Output['token'], unlockingBytecode: Uint8Array = new Uint8Array()): WcSourceOutput {
  return { outpointTransactionHash: new Uint8Array(32), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode, lockingBytecode, valueSatoshis, ...(token && { token }) }
}
function transactionOf(sourceOutputs: WcSourceOutput[], outputs: Output[]): Transaction {
  const inputs = sourceOutputs.map(({ outpointTransactionHash, outpointIndex, sequenceNumber, unlockingBytecode }) =>
    ({ outpointTransactionHash, outpointIndex, sequenceNumber, unlockingBytecode }))
  return { version: 2, locktime: 0, inputs, outputs }
}

describe('summarizeDappTransaction', () => {
  it('counts only the wallet\'s coins in the balance change, and every coin in the fee', () => {
    const sourceOutputs = [coin(wallet, 10_000n), coin(thirdParty, 5_000n)]
    const outputs = [{ lockingBytecode: payee, valueSatoshis: 12_000n }, { lockingBytecode: wallet, valueSatoshis: 2_500n }]
    const summary = summarizeDappTransaction(transactionOf(sourceOutputs, outputs), sourceOutputs, isWallet)
    expect(summary.bchBalanceChange).toBe(-7_500n)
    expect(summary.fee).toBe(500n)
  })

  it('nets fungible tokens per category and lists the NFTs leaving and arriving', () => {
    const sourceOutputs = [
      coin(wallet, 1_000n, { category: categoryA, amount: 100n }),
      coin(wallet, 1_000n, { category: categoryB, amount: 0n, nft: { capability: 'none', commitment: hexToBin('01') } }),
      coin(thirdParty, 1_000n, { category: categoryB, amount: 0n, nft: { capability: 'none', commitment: hexToBin('02') } }),
    ]
    const outputs = [
      { lockingBytecode: thirdParty, valueSatoshis: 800n, token: { category: categoryA, amount: 40n } },
      { lockingBytecode: wallet, valueSatoshis: 800n, token: { category: categoryA, amount: 60n } },
      { lockingBytecode: thirdParty, valueSatoshis: 800n, token: sourceOutputs[1]!.token! },
      { lockingBytecode: wallet, valueSatoshis: 800n, token: sourceOutputs[2]!.token! },
    ]
    const summary = summarizeDappTransaction(transactionOf(sourceOutputs, outputs), sourceOutputs, isWallet)
    expect(summary.ftNetChanges).toEqual({ [binToHex(categoryA)]: -40n })
    expect(summary.nftsSpent.map(nft => binToHex(nft.nft!.commitment))).toEqual(['01'])
    expect(summary.nftsReceived.map(nft => binToHex(nft.nft!.commitment))).toEqual(['02'])
  })

  // the fee rate is read against the size once signed, so a dapp can't make a low fee look normal
  it('adds a signature and public key for each wallet input that arrives empty, and only those', () => {
    const sourceOutputs = [coin(wallet, 5_000n), coin(wallet, 5_000n, undefined, hexToBin('00')), coin(thirdParty, 5_000n)]
    const transaction = transactionOf(sourceOutputs, [{ lockingBytecode: payee, valueSatoshis: 14_000n }])
    expect(summarizeDappTransaction(transaction, sourceOutputs, isWallet).signedSize).toBe(encodeTransaction(transaction).length + 100)
  })
})

describe('scriptDisplay', () => {
  it('shows an address where the script has one, and the script itself where it has none', () => {
    expect(scriptDisplay(wallet, 'bitcoincash')).toMatch(/^bitcoincash:q/)
    expect(scriptDisplay(hexToBin('6a0401020304'), 'bitcoincash')).toBe('opreturn:6a0401020304')
    expect(scriptDisplay(hexToBin('51'), 'bitcoincash')).toBe('script:51')
  })
})
