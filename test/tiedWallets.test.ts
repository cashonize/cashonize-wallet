import { describe, it, expect, beforeEach } from 'vitest'
import { mockDeleteNamedWallet, mockGetHistory, mockGetNamedWalletId } from './mocks/walletUtils.mocks'
import { chipnetCopyHasHistory, removeUnusedChipnetCopy, tiedChipnetCopy } from '../src/utils/wallet/tiedWallets'
import { getAddrsByXpubKey, getXPubKey } from '@cashonize/bch-wallet-lib'
import { deriveSeedFromBip39Mnemonic } from '@bitauth/libauth'

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const mainnetHd = `hd:mainnet:${mnemonic}:m/44'/145'/0':0:0`
const chipnetHd = `hd:testnet:${mnemonic}:m/44'/145'/0':0:0`
// the first receive address of that seed on the path, on chipnet
const firstChipnetAddress = 'bchtest:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnqseeszx8x'

function storedIds(ids: Record<string, string | undefined>) {
  mockGetNamedWalletId.mockImplementation((_name: string, dbName: string) => Promise.resolve(ids[dbName]))
}

describe('tiedChipnetCopy', () => {
  beforeEach(() => {
    mockGetNamedWalletId.mockReset()
  })

  it('finds a chipnet row that is the mainnet id with its network replaced', async () => {
    storedIds({ bitcoincash: mainnetHd, bchtest: chipnetHd })
    expect(await tiedChipnetCopy('w')).toBe(chipnetHd)
  })

  it('finds nothing when a row is missing or the rows differ in anything but the network', async () => {
    storedIds({ bitcoincash: mainnetHd, bchtest: undefined })
    expect(await tiedChipnetCopy('w')).toBeUndefined()
    storedIds({ bitcoincash: undefined, bchtest: chipnetHd })
    expect(await tiedChipnetCopy('w')).toBeUndefined()
    storedIds({ bitcoincash: mainnetHd, bchtest: chipnetHd.replace('about', 'abandon') })
    expect(await tiedChipnetCopy('w')).toBeUndefined()
    storedIds({ bitcoincash: mainnetHd, bchtest: chipnetHd.replace("m/44'/145'", "m/44'/0'") })
    expect(await tiedChipnetCopy('w')).toBeUndefined()
    storedIds({ bitcoincash: mainnetHd, bchtest: chipnetHd.replace('hd:', 'seed:') })
    expect(await tiedChipnetCopy('w')).toBeUndefined()
  })
})

describe('chipnetCopyHasHistory', () => {
  beforeEach(() => {
    mockGetHistory.mockReset()
    mockGetHistory.mockResolvedValue([])
  })

  it('reads the receive and change addresses of an HD copy on chipnet', async () => {
    expect(await chipnetCopyHasHistory(chipnetHd)).toBe(false)
    const asked = mockGetHistory.mock.calls.map(([address]) => address as string)
    expect(asked).toHaveLength(40)
    expect(asked).toContain(firstChipnetAddress)
    expect(asked.every(address => address.startsWith('bchtest:'))).toBe(true)
  })

  it('tells a used HD copy by the history of its last change address read', async () => {
    const xpub = getXPubKey(deriveSeedFromBip39Mnemonic(mnemonic), "m/44'/145'/0'", 'testnet')
    const lastChange = getAddrsByXpubKey(xpub, '1/19', 1)[0]
    mockGetHistory.mockImplementation((address: string) =>
      Promise.resolve(address === lastChange ? [{ tx_hash: 'aa', height: 1 }] : []))
    expect(await chipnetCopyHasHistory(chipnetHd)).toBe(true)
  })

  it('reads the one address of a single-address copy', async () => {
    expect(await chipnetCopyHasHistory(`seed:testnet:${mnemonic}:m/44'/145'/0'/0/0`)).toBe(false)
    expect(mockGetHistory.mock.calls).toEqual([[firstChipnetAddress]])
  })

  it('counts a copy it cannot read as used, and lets a failed lookup through', async () => {
    expect(await chipnetCopyHasHistory('wif:testnet:cPS12C2bpGHtKjS5NXNyWyTGGRMPk7D7pjp5JfgxRKWyFnWoDyZg')).toBe(true)
    expect(await chipnetCopyHasHistory(`seed:testnet:${mnemonic}:m/44'/145'/0'/0'/0`)).toBe(true)
    mockGetHistory.mockRejectedValue(new Error('server lost'))
    await expect(chipnetCopyHasHistory(chipnetHd)).rejects.toThrow('server lost')
  })
})

describe('removeUnusedChipnetCopy', () => {
  beforeEach(() => {
    mockGetNamedWalletId.mockReset()
    mockDeleteNamedWallet.mockReset()
    mockGetHistory.mockReset()
    mockGetHistory.mockResolvedValue([])
    storedIds({ bitcoincash: mainnetHd, bchtest: chipnetHd })
  })

  it('deletes the chipnet row only, once every check passes', async () => {
    await removeUnusedChipnetCopy('w', chipnetHd)
    expect(mockDeleteNamedWallet).toHaveBeenCalledTimes(1)
    expect(mockDeleteNamedWallet).toHaveBeenCalledWith('w', 'bchtest')
  })

  it('deletes nothing when the chipnet row is not the copy that was checked', async () => {
    await expect(removeUnusedChipnetCopy('w', chipnetHd.replace('about', 'abandon'))).rejects.toThrow()
    storedIds({ bitcoincash: mainnetHd, bchtest: chipnetHd.replace('about', 'abandon') })
    await expect(removeUnusedChipnetCopy('w', chipnetHd)).rejects.toThrow()
    expect(mockDeleteNamedWallet).not.toHaveBeenCalled()
  })

  it('deletes nothing when the mainnet row is gone or holds other keys', async () => {
    storedIds({ bitcoincash: undefined, bchtest: chipnetHd })
    await expect(removeUnusedChipnetCopy('w', chipnetHd)).rejects.toThrow()
    storedIds({ bitcoincash: mainnetHd.replace('about', 'abandon'), bchtest: chipnetHd })
    await expect(removeUnusedChipnetCopy('w', chipnetHd)).rejects.toThrow()
    expect(mockDeleteNamedWallet).not.toHaveBeenCalled()
  })

  it('reads the rows again after the history, so a row changed during the read is not deleted', async () => {
    // another tab deletes the wallet and makes a new chipnet wallet of that name while the history
    // is read
    mockGetHistory.mockImplementation(() => {
      storedIds({ bitcoincash: undefined, bchtest: chipnetHd.replace('about', 'abandon') })
      return Promise.resolve([])
    })
    await expect(removeUnusedChipnetCopy('w', chipnetHd)).rejects.toThrow()
    expect(mockDeleteNamedWallet).not.toHaveBeenCalled()
  })

  it('deletes nothing when the copy has history, or its history cannot be read', async () => {
    mockGetHistory.mockResolvedValue([{ tx_hash: 'aa', height: 1 }])
    await expect(removeUnusedChipnetCopy('w', chipnetHd)).rejects.toThrow()
    mockGetHistory.mockRejectedValue(new Error('server lost'))
    await expect(removeUnusedChipnetCopy('w', chipnetHd)).rejects.toThrow('server lost')
    expect(mockDeleteNamedWallet).not.toHaveBeenCalled()
  })
})
