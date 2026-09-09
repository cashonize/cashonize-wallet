import { describe, expect, it } from 'vitest'
import { binToHex, hexToBin, utf8ToBin } from '@bitauth/libauth'

import builtinContracts from '../src/utils/contracts/builtinContracts.json'
import {
  ContractBundleSchema,
  buildScript,
  readAnnouncement,
  readCommitment,
} from '../src/utils/contracts/contractManifest'
import { contractAddress, scriptHash } from '../src/utils/contracts/redeemScript'

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
    expect(bundle.contracts.length).toBeGreaterThan(0)
  })

  // a repeated id would shadow one manifest with another, silently, since a lookup takes the first
  it('names each contract once', () => {
    const ids = bundle.contracts.map(contract => contract.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})

// The Badgers lock: one contract address for everyone, the owner written into the lock's NFT.
// The layout the lock is read with, which is the whole of what the wallet needs to know.
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

  it('reads an announcement into the contract it names and its locktime', () => {
    const { script, opReturn } = hodlAnnouncement(800_000, ownerPkh)

    const fromManifest = readAnnouncement(opReturn, find)

    expect(fromManifest).toEqual({ announcedScriptHash: scriptHash(script, 'p2sh20'), locktime: 800_000 })
  })

  // the plugin's address chunk is "<address> <version>", so the reading takes the first word
  it('takes the address off a chunk carrying a version suffix', () => {
    const { address, script } = hodlAnnouncement(800_000, ownerPkh)
    const opReturn = '6a04686f646c' + push(utf8ToBin(`${address} 2`)) + push(utf8ToBin('800000'))

    expect(readAnnouncement(opReturn, find)?.announcedScriptHash).toBe(scriptHash(script, 'p2sh20'))
  })

  // Real mainnet announcements, the fixtures the hodl module was tested against. The plugin writes
  // the contract address in three encodings, so the manifest reads the hash it commits to rather
  // than the string: comparing strings would only ever have matched the middle one.
  describe('the three encodings creating software writes', () => {
    const legacy = '6a04686f646c243332636757766b314b34326262333232695379784572514c43657453736f72637943203106373135353537'
    const cashaddr = '6a04686f646c36626974636f696e636173683a707068307878357563386c7068756a6d73726a7965683565737963667a63337776356572737565766e3906383836363632'

    it('reads a legacy base58 address with a version suffix', () => {
      expect(readAnnouncement(legacy, find)).toEqual({
        announcedScriptHash: '0a2642fad2942bc98c6e2c4999505c7d42a4fbf0', locktime: 715_557,
      })
    })

    it('reads a prefixed cashaddr', () => {
      expect(readAnnouncement(cashaddr, find)).toEqual({
        announcedScriptHash: '6ef31a9cc1fe1bf25b80e44cde99813091622e65', locktime: 886_662,
      })
    })

    it('reads a cashaddr with its prefix stripped', () => {
      const prefixless = cashaddr.replace('36626974636f696e636173683a', '2a')

      expect(readAnnouncement(prefixless, find)).toEqual({
        announcedScriptHash: '6ef31a9cc1fe1bf25b80e44cde99813091622e65', locktime: 886_662,
      })
    })

    // the locktime is a decimal string, so anything else in that push is not this announcement
    it('refuses a malformed locktime', () => {
      const bad = cashaddr.replace('06383836363632', '0631323334F536')

      expect(readAnnouncement(bad, find)).toBeUndefined()
    })

    // the wallet that owns the second announcement, rebuilt from its key
    it('rebuilds the real announced contract from its owner key', () => {
      const fields = readAnnouncement(cashaddr, find)!
      const built = buildScript(hodl.script!, { locktime: fields.locktime!, ownerPkh })!

      expect(scriptHash(built, 'p2sh20')).toBe(fields.announcedScriptHash)
    })
  })

  // every hole is a push, so its opcode follows from the value; bytes is what the value has to be
  it('refuses a parameter of the wrong length', () => {
    expect(buildScript(hodl.script!, { locktime: 800_000, ownerPkh: 'ab'.repeat(19) })).toBeUndefined()
    expect(buildScript(hodl.script!, { locktime: 800_000, ownerPkh: 'ab'.repeat(20) })).toBeDefined()
  })

  it('refuses an announcement of another protocol', () => {
    expect(readAnnouncement('6a044d505357' + push(utf8ToBin('x')), find)).toBeUndefined()
  })

  // the whole of the ownership rule: the script built from the wallet's own key reproduces the
  // address the announcement named
  it('rebuilds the announced address from the owner key', () => {
    const { address, opReturn } = hodlAnnouncement(800_000, ownerPkh)
    const fields = readAnnouncement(opReturn, find)!

    const rebuilt = buildScript(hodl.script!, { locktime: fields.locktime!, ownerPkh })!
    expect(contractAddress(rebuilt, 'p2sh20', 'bitcoincash')).toBe(address)
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
