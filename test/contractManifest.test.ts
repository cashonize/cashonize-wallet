import { describe, expect, it } from 'vitest'
import { binToHex, hexToBin, utf8ToBin } from '@bitauth/libauth'

import builtinContracts from '../src/utils/contracts/builtinContracts.json'
import {
  ContractBundleSchema,
  buildScript,
  readAnnouncement,
  readCommitment,
} from '../src/utils/contracts/contractManifest'
import { contractAddress } from '../src/utils/contracts/redeemScript'
import { parseHodlAnnouncement, hodlContractsFromHistory } from '../src/utils/defi/hodlContracts'
import { historyItem, opReturnOutput, p2pkhOutput } from './mocks/history.mocks'

const bundle = ContractBundleSchema.parse(builtinContracts)
const manifest = (id: string) => {
  const found = bundle.contracts.find(contract => contract.id === id)
  if (!found) throw new Error(`no manifest ${id}`)
  return found
}

const ownerPkh = '8ee26d6c9f58369f94864dc3630cdeb17fae2f2d'
const push = (bytes: Uint8Array) => binToHex(Uint8Array.from([bytes.length, ...bytes]))

// A hodl announcement as the plugin writes one: the Lokad id, the contract address, the locktime
// as a decimal string. The address is the one the manifest's own template produces, which is what
// makes the announcement and the rebuild agree.
function hodlAnnouncement(locktime: number, pkh: string) {
  const hodl = manifest('hodl-vault')
  const script = buildScript(hodl.script!, { locktime, ownerPkh: pkh })!
  const address = contractAddress(script, 'p2sh20', 'bitcoincash')!
  return { address, script, opReturn: '6a04686f646c' + push(utf8ToBin(address)) + push(utf8ToBin(String(locktime))) }
}

describe('the built-in bundle', () => {
  // the built-ins go through the same schema a user's bundle would, so shipping a malformed one
  // fails here rather than at a wallet open
  it('validates against the schema it asks of a user', () => {
    expect(bundle.contracts.map(contract => contract.id)).toEqual(['badgers-stake', 'hodl-vault'])
  })
})

// The Badgers lock: one contract address for everyone, the owner written into the lock's NFT.
// The layout is the one badgersStake.ts reads, expressed as data instead.
describe('badgers-stake', () => {
  const badgers = manifest('badgers-stake')
  const layout = badgers.find.kind === 'address' ? badgers.find.commitment! : undefined!

  it('reads the payout key hash and stake length off a lock commitment', () => {
    const commitment = ownerPkh + '00'.repeat(18) + 'a000'

    expect(readCommitment(commitment, layout)).toEqual({ payoutPkh: ownerPkh, stakeBlocks: 160 })
  })

  it('refuses a commitment that is not the contract"s length', () => {
    expect(readCommitment(ownerPkh, layout)).toBeUndefined()
  })

  it('names the owner field ownership is proved against', () => {
    expect(badgers.owner).toEqual({ kind: 'field', field: 'payoutPkh' })
  })
})

describe('hodl-vault', () => {
  const hodl = manifest('hodl-vault')
  const find = hodl.find.kind === 'announcement' ? hodl.find : undefined!

  // the manifest and the module have to read the same announcement the same way, or the manifest
  // is not a description of the contract the wallet already finds
  it('reads an announcement exactly as hodlContracts.ts does', () => {
    const { address, opReturn } = hodlAnnouncement(800_000, ownerPkh)

    const fromManifest = readAnnouncement(opReturn, find)
    const fromModule = parseHodlAnnouncement(opReturn)

    expect(fromManifest).toEqual({ announcedAddress: address, locktime: 800_000 })
    expect(fromModule?.locktime).toBe(fromManifest?.locktime)
  })

  // the plugin's address chunk is "<address> <version>", so the reading takes the first word
  it('takes the address off a chunk carrying a version suffix', () => {
    const { address } = hodlAnnouncement(800_000, ownerPkh)
    const opReturn = '6a04686f646c' + push(utf8ToBin(`${address} 2`)) + push(utf8ToBin('800000'))

    expect(readAnnouncement(opReturn, find)?.announcedAddress).toBe(address)
  })

  it('refuses an announcement of another protocol', () => {
    expect(readAnnouncement('6a044d505357' + push(utf8ToBin('x')), find)).toBeUndefined()
  })

  // the whole of the ownership rule: the script built from the wallet's own key reproduces the
  // address the announcement named
  it('rebuilds the announced address from the owner key, as the module does', () => {
    const { address, opReturn } = hodlAnnouncement(800_000, ownerPkh)
    const fields = readAnnouncement(opReturn, find)!

    const rebuilt = buildScript(hodl.script!, { locktime: fields.locktime!, ownerPkh })!
    expect(contractAddress(rebuilt, 'p2sh20', 'bitcoincash')).toBe(address)

    // and the module agrees this history item is the wallet's contract
    const history = [historyItem('aa'.repeat(32), [opReturnOutput(opReturn), p2pkhOutput()])]
    expect(hodlContractsFromHistory(history, [ownerPkh])).toHaveLength(1)
  })

  it('does not rebuild the announced address from somebody else"s key', () => {
    const { address, opReturn } = hodlAnnouncement(800_000, ownerPkh)
    const stranger = 'ff'.repeat(20)
    const fields = readAnnouncement(opReturn, find)!

    const rebuilt = buildScript(hodl.script!, { locktime: fields.locktime!, ownerPkh: stranger })!
    expect(contractAddress(rebuilt, 'p2sh20', 'bitcoincash')).not.toBe(address)
  })

  // a timestamp locktime is four bytes where a block height is three, so the encoding has to grow
  it('builds the same script for a timestamp locktime', () => {
    const { address, opReturn } = hodlAnnouncement(1_800_000_000, ownerPkh)
    const fields = readAnnouncement(opReturn, find)!

    expect(fields.locktime).toBe(1_800_000_000)
    const rebuilt = buildScript(hodl.script!, { locktime: fields.locktime!, ownerPkh })!
    expect(contractAddress(rebuilt, 'p2sh20', 'bitcoincash')).toBe(address)
    // 0x6b49d200, whose top byte leaves the sign bit clear, so four bytes encode it
    expect(hexToBin(rebuilt)[0]).toBe(4)
  })

  // a locktime whose top bit is set would read as negative, so the minimal encoding grows by a
  // zero byte; the address only matches if the manifest grows it the same way the module does
  it('pads a locktime that would otherwise read as negative', () => {
    const { address, opReturn } = hodlAnnouncement(0x80000000, ownerPkh)
    const fields = readAnnouncement(opReturn, find)!

    const rebuilt = buildScript(hodl.script!, { locktime: fields.locktime!, ownerPkh })!
    expect(hexToBin(rebuilt)[0]).toBe(5)
    expect(contractAddress(rebuilt, 'p2sh20', 'bitcoincash')).toBe(address)
  })
})
