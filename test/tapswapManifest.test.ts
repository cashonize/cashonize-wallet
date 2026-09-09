import { describe, expect, it, vi } from 'vitest'
import { binToHex, bigIntToVmNumber } from '@bitauth/libauth'
import type { ElectrumNetworkProvider, TransactionHistoryItem, Utxo } from 'mainnet-js'

import { builtinManifest } from '../src/utils/contracts/builtins'
import { readAnnouncement } from '../src/utils/contracts/contractManifest'
import { runManifest } from '../src/utils/contracts/runManifest'
import { historyItem, opReturnOutput, tokenOutput } from './mocks/history.mocks'

const tapswap = builtinManifest('tapswap-listing')
const find = tapswap.find.kind === 'announcement' ? tapswap.find : undefined!

const makerPkh = '8ee26d6c9f58369f94864dc3630cdeb17fae2f2d'
const stranger = 'ff'.repeat(20)
const platformPkh = 'e4da17ddbe40533c2a8638fdedf2c0997d46e953'
const category = 'cc'.repeat(32)
const contractAddress = 'bitcoincash:pzlisting'
const listingTxid = 'ab'.repeat(32)

const push = (hex: string) => {
  if (hex === '') return '00'
  const bytes = hex.length / 2
  return bytes.toString(16).padStart(2, '0') + hex
}
const numberPush = (value: bigint) => push(binToHex(bigIntToVmNumber(value)))

// The listing announcement: marker and version in the prefix, then the contract hash, the
// platform key, the price, three want fields left empty by an offer asking plain BCH, the maker
// and the fee. The three empty pushes are what a length walk of the bytes would stumble on.
function announcement(price: bigint, maker: string, wants = ['', '', '']) {
  return '6a044d5053570104043d400caf'
    + push(platformPkh) + numberPush(price)
    + wants.map(want => push(want)).join('')
    + push(maker) + numberPush(1000n)
}

function listingHistory(price: bigint, maker: string): TransactionHistoryItem[] {
  return [historyItem(listingTxid, [
    tokenOutput(category, { commitment: '01' }, contractAddress),
    opReturnOutput(announcement(price, maker)),
  ])]
}

function providerFor(utxos: Utxo[]) {
  return { getUtxos: vi.fn(() => Promise.resolve(utxos)) } as unknown as ElectrumNetworkProvider
}

const contractUtxo: Utxo = {
  txid: listingTxid, vout: 0, satoshis: 1000n, address: contractAddress,
  token: { category, amount: 0n, nft: { capability: 'none', commitment: '01' } },
}

const context = (provider: ElectrumNetworkProvider, history: TransactionHistoryItem[]) =>
  ({ provider, ownerPkhs: [makerPkh], history, networkPrefix: 'bitcoincash' })

// Real mainnet listing announcements, the fixtures the TapSwap module was tested against: an NFT
// listed for 0.04 BCH and a fungible listing, with different makers.
describe('real listing announcements', () => {
  const nftListing = '6a044d5053570104043d400caf14e4da17ddbe40533c2a8638fdedf2c0997d46e9530300093d000000148ee26d6c9f58369f94864dc3630cdeb17fae2f2d03c0d401'
  const ftListing = '6a044d5053570104043d400caf14e4da17ddbe40533c2a8638fdedf2c0997d46e9530105000000142458b6396f0f866f4b60af2b7655dc9fc490e0c403a08601'

  it('reads an NFT listing', () => {
    expect(readAnnouncement(nftListing, find)).toEqual({
      platformPkh, priceSats: 4_000_000, makerPkh, feeSats: 120_000,
      wantCategory: '', wantAmount: '', wantCommitment: '',
    })
  })

  it('reads a fungible listing made by another maker', () => {
    expect(readAnnouncement(ftListing, find)).toEqual({
      platformPkh, priceSats: 5, makerPkh: '2458b6396f0f866f4b60af2b7655dc9fc490e0c4', feeSats: 100_000,
      wantCategory: '', wantAmount: '', wantCommitment: '',
    })
  })
})

describe('reading a listing announcement', () => {
  it('reads the offer past the empty want fields', () => {
    expect(readAnnouncement(announcement(25_000_000n, makerPkh), find)).toEqual({
      platformPkh, priceSats: 25_000_000, makerPkh, feeSats: 1000,
      wantCategory: '', wantAmount: '', wantCommitment: '',
    })
  })

  // the platform key is enforced by the contract, so an announcement naming another one is not
  // a listing of this protocol whatever else it looks like
  it('refuses an announcement naming another platform key', () => {
    const other = announcement(25_000_000n, makerPkh).replace(platformPkh, 'aa'.repeat(20))

    expect(readAnnouncement(other, find)).toBeUndefined()
  })

  // the format allows asking for tokens, but this manifest describes only the plain-BCH offer,
  // whose price is the one number a portfolio can show
  it('refuses an offer asking for something other than BCH', () => {
    const asksTokens = announcement(25_000_000n, makerPkh, [category, '01', ''])

    expect(readAnnouncement(asksTokens, find)).toBeUndefined()
  })

  it('refuses an announcement of another protocol', () => {
    expect(readAnnouncement('6a04686f646c' + push(makerPkh), find)).toBeUndefined()
  })
})

describe('finding listings', () => {
  it('finds the wallet"s own listing and what it holds', async () => {
    const positions = await runManifest(tapswap, context(providerFor([contractUtxo]), listingHistory(25_000_000n, makerPkh)))

    expect(positions).toHaveLength(1)
    expect(positions[0]?.txid).toBe(listingTxid)
    expect(positions[0]?.vout).toBe(0)
    expect(positions[0]?.address).toBe(contractAddress)
    expect(positions[0]?.fields.priceSats).toBe(25_000_000)
    expect(positions[0]?.token?.category).toBe(category)
    // cancelling returns the asset at any time, so a listing is owned rather than locked
    expect(positions[0]?.ownership).toBe('owned')
  })

  // the maker is named in the announcement, so no contract is rebuilt to know whose it is
  it('leaves a listing another maker announced alone', async () => {
    const positions = await runManifest(tapswap, context(providerFor([contractUtxo]), listingHistory(25_000_000n, stranger)))

    expect(positions).toEqual([])
  })

  // buying or cancelling spends the contract output, which is the only thing that says a listing
  // has ended; the announcement stays in the history forever
  it('drops a listing whose contract output has been spent', async () => {
    const positions = await runManifest(tapswap, context(providerFor([]), listingHistory(25_000_000n, makerPkh)))

    expect(positions).toEqual([])
  })

  // the contract address can hold other coins, so the listing is the one output the announcement
  // was made about rather than anything sitting there
  it('does not mistake another coin at the contract address for the listing', async () => {
    const other = { ...contractUtxo, vout: 1 }
    const positions = await runManifest(tapswap, context(providerFor([other]), listingHistory(25_000_000n, makerPkh)))

    expect(positions).toEqual([])
  })

  it('ignores a transaction that is no listing at all', async () => {
    const plain = [historyItem('cd'.repeat(32), [tokenOutput(category, { commitment: '01' }, contractAddress)])]

    expect(await runManifest(tapswap, context(providerFor([contractUtxo]), plain))).toEqual([])
  })

  it('ignores a listing whose announcement sits at another output', async () => {
    const moved = [historyItem(listingTxid, [
      opReturnOutput(announcement(25_000_000n, makerPkh)),
      tokenOutput(category, { commitment: '01' }, contractAddress),
    ])]

    expect(await runManifest(tapswap, context(providerFor([contractUtxo]), moved))).toEqual([])
  })
})
