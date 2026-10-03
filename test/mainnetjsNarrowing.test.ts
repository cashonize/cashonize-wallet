import { describe, expect, it } from 'vitest'
import { BaseWallet, ElectrumNetworkProvider, FeePaidByEnum, SendRequest, getHistory } from 'mainnet-js'
import type { Utxo } from 'mainnet-js'
// not on the package's export surface, so reached by path
import { getSuitableUtxos } from '../node_modules/mainnet-js/dist/module/transaction/Wif.js'
import { OP_RETURN_ADDRESS_PREFIX } from '../src/utils/history/txDirection'
import { binToHex, encodeTransaction, hashTransaction, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth'
import { electrumTimeoutMessage } from '../src/utils/wallet/broadcastErrors'

// The wallet keeps frozen and reserved coins out of a spend by narrowing mainnet-js's pool with
// the utxoIds option, so every method that selects inputs has to honor it. tokenMint and tokenBurn
// only do because of the pnpm patch (see pnpm-workspace.yaml): if it ever stops applying, a held
// back token coin quietly becomes mintable from and burnable again, with nothing else to notice.
// checkUtxos is the call that does the narrowing, so its presence is what these look for.
const narrowingMethods = [
  '_getMaxAmountToSend', // sendMax and getMaxAmountToSend both go through it
  'encodeTransaction', // every send(), token requests included; the wallet classes delegate here
  'tokenGenesis',
  'tokenMint', // patched
  'tokenBurn', // patched
] as const

describe('mainnet-js narrows its input selection to options.utxoIds', () => {
  for (const method of narrowingMethods) {
    it(`${method} narrows the utxos it selects from`, () => {
      const source = (BaseWallet.prototype as unknown as Record<string, () => unknown>)[method]?.toString()
      expect(source).toBeDefined()
      expect(source).toContain('checkUtxos')
    })
  }
})

// The store's spend explainer appends the held-back reason to mainnet-js's shortfall messages,
// matched by their opening words, so a rewording upstream would silently drop the explanation
const shortfallMessages = [
  { method: 'encodeTransaction', message: 'Not enough token amount to send' },
  { method: 'encodeTransaction', message: 'There were no Unspent Outputs' },
  { method: 'encodeTransaction', message: "The available inputs couldn't satisfy the request with fees" },
  { method: 'tokenMint', message: 'You do not have any token UTXOs with minting capability for specified category' },
  { method: 'tokenBurn', message: 'You do not have suitable token UTXOs to perform burn' },
] as const

describe('mainnet-js still reports a shortfall in the words the explainer matches', () => {
  for (const { method, message } of shortfallMessages) {
    it(`${method} says "${message}"`, () => {
      const source = (BaseWallet.prototype as unknown as Record<string, () => unknown>)[method]?.toString()
      expect(source).toContain(message)
    })
  }

  it('getSuitableUtxos says "Amount required was not met"', () => {
    expect(getSuitableUtxos.toString()).toContain('Amount required was not met')
  })
})

// A broadcast that timed out may still have been sent, which the classifier only recognizes by
// this exact string, so a rewording upstream would drop the warning to check history first
describe('mainnet-js still rejects a timed out request with the string the classifier matches', () => {
  it('performRequest times out with electrumTimeoutMessage', () => {
    const source = (ElectrumNetworkProvider.prototype as unknown as Record<string, () => unknown>)['performRequest']?.toString()
    expect(source).toContain(electrumTimeoutMessage)
  })
})

// The sweep at the end of transferring all assets hands sendMax a pool that still holds token
// UTXOs, trusting that the plain-BCH selection never takes one: a token UTXO swept as plain BCH
// would burn its tokens. sendMax picks its inputs here, so this is where that has to hold.
describe('mainnet-js never funds a plain BCH send from a token UTXO', () => {
  it('getSuitableUtxos leaves a token UTXO out of a plain send', async () => {
    const address = 'bitcoincash:qtest'
    const bch: Utxo = { txid: '11'.repeat(32), vout: 0, satoshis: 10_000n, address }
    const tokenCoin: Utxo = { txid: '22'.repeat(32), vout: 0, satoshis: 100_000n, address, token: { category: '33'.repeat(32), amount: 5n } }
    const request = new SendRequest({ cashaddr: address, value: 1000n })

    const selected = await getSuitableUtxos([tokenCoin, bch], undefined, 0, FeePaidByEnum.change, [request])

    expect(selected).toEqual([bch])
  })
})

// The TapSwap, hodl and identity readers find their announcements in the address mainnet-js
// gives an OP_RETURN output on a history item, so a rewording upstream would silently find none
describe('mainnet-js still names an OP_RETURN history output the way the readers expect', () => {
  it(`getHistory builds the address as "${OP_RETURN_ADDRESS_PREFIX}<hex>"`, () => {
    expect(getHistory.toString()).toContain('`' + OP_RETURN_ADDRESS_PREFIX + '${')
  })
})

// A P2S output has no CashAddress. Unpatched, getHistory asserted one for every output and spent
// input, so one such coin anywhere in the history threw the whole call (see pnpm-workspace.yaml)
describe('mainnet-js getHistory reads a history that holds a P2S coin', () => {
  it('reports it with a placeholder address and its locking bytecode', async () => {
    const p2pkh = `76a914${'01'.repeat(20)}88ac`
    const p2s = '51ce8851d0009d6300cdc0c7886851'
    const address = lockingBytecodeToCashAddress({ bytecode: hexToBin(p2pkh), prefix: 'bitcoincash' })
    if (typeof address === 'string') throw new Error(address)
    const encode = (outpointHash: string, outputs: string[]) => {
      const encoded = encodeTransaction({
        version: 2,
        locktime: 0,
        inputs: [{ outpointTransactionHash: hexToBin(outpointHash), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: new Uint8Array() }],
        outputs: outputs.map(bytecode => ({ lockingBytecode: hexToBin(bytecode), valueSatoshis: 1000n })),
      })
      return { hex: binToHex(encoded), hash: hashTransaction(encoded) }
    }
    const funding = encode('aa'.repeat(32), [p2s])
    const spend = encode(funding.hash, [p2pkh, p2s])
    const raw = new Map([[funding.hash, funding.hex], [spend.hash, spend.hex]])
    const provider = {
      getHistory: () => Promise.resolve([{ tx_hash: spend.hash, height: 0 }]),
      getRawTransactions: (hashes: string[]) => Promise.resolve(new Map(hashes.map(hash => [hash, raw.get(hash)]))),
      getBalance: () => Promise.resolve(0),
    } as unknown as ElectrumNetworkProvider

    const [item] = await getHistory({ addresses: [address.address], provider })

    expect(item?.inputs[0]).toMatchObject({ address: `SCRIPT: ${p2s}`, lockingBytecode: p2s })
    expect(item?.outputs.map(output => output.lockingBytecode)).toEqual([p2pkh, p2s])
    expect(item?.outputs[0]?.address).toBe(address.address)
  })
})

// The reserve's token change is built by the wallet because mainnet-js's own change copies the
// first token output's NFT onto it; if that changes upstream, the wallet's change is only redundant
describe('mainnet-js still copies the first token output\'s NFT onto its token change', () => {
  it('encodeTransaction builds the change with nft: tokenOutputs[0].nft', () => {
    const source = (BaseWallet.prototype as unknown as Record<string, () => unknown>)['encodeTransaction']?.toString()
    expect(source).toContain('nft: tokenOutputs[0].nft')
  })
})
