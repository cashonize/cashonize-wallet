import { describe, it, expect, beforeEach } from 'vitest'
import { mockDeleteNamedWallet, mockGetHistory, mockGetNamedWalletId, mockGetNetworkProvider, mockGetUtxos } from './mocks/walletUtils.mocks'
import { chipnetCopyState, removeEmptyChipnetCopy, tiedChipnetCopy } from '../src/utils/wallet/tiedWallets'
import { getAddrsByXpubKey, getXPubKey } from '@cashonize/bch-wallet-lib'
import { deriveSeedFromBip39Mnemonic } from '@bitauth/libauth'

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const mainnetHd = `hd:mainnet:${mnemonic}:m/44'/145'/0':0:0`
const chipnetHd = `hd:testnet:${mnemonic}:m/44'/145'/0':0:0`
// the first receive address of that seed on the path, on chipnet
const firstChipnetAddress = 'bchtest:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnqseeszx8x'
const xpub = getXPubKey(deriveSeedFromBip39Mnemonic(mnemonic), "m/44'/145'/0'", 'testnet')
const chipnetAddress = (chain: number, index: number) => getAddrsByXpubKey(xpub, `${chain}/${index}`, 1)[0]!
const someHistory = [{ tx_hash: 'aa', height: 1 }]
const someUtxo = { txid: 'aa', vout: 0, satoshis: 1000n }

function storedIds(ids: Record<string, string | undefined>) {
  mockGetNamedWalletId.mockImplementation((_name: string, dbName: string) => Promise.resolve(ids[dbName]))
}
// history on the given addresses only, and coins on the given ones only
function chipnetChain({ used = [] as string[], funded = [] as string[] }) {
  mockGetHistory.mockImplementation((address: string) => Promise.resolve(used.includes(address) ? someHistory : []))
  mockGetUtxos.mockImplementation((address: string) => Promise.resolve(funded.includes(address) ? [someUtxo] : []))
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

describe('chipnetCopyState', () => {
  beforeEach(() => {
    mockGetHistory.mockReset()
    mockGetUtxos.mockReset()
    mockGetNetworkProvider.mockClear()
    chipnetChain({})
  })

  it('reads an unused HD copy on chipnet, 20 addresses deep on each chain', async () => {
    expect(await chipnetCopyState(chipnetHd)).toBe('unused')
    expect(mockGetNetworkProvider.mock.calls).toEqual([['testnet']])
    const asked = mockGetHistory.mock.calls.map(([address]) => address as string)
    expect(asked).toHaveLength(40)
    expect(asked).toContain(firstChipnetAddress)
    expect(asked.every(address => address.startsWith('bchtest:'))).toBe(true)
    expect(mockGetUtxos).not.toHaveBeenCalled()
  })

  it('tells a used copy without coins from one holding coins', async () => {
    chipnetChain({ used: [chipnetAddress(0, 0), chipnetAddress(1, 3)] })
    expect(await chipnetCopyState(chipnetHd)).toBe('empty')
    chipnetChain({ used: [chipnetAddress(0, 0), chipnetAddress(1, 3)], funded: [chipnetAddress(1, 3)] })
    expect(await chipnetCopyState(chipnetHd)).toBe('holdsCoins')
  })

  it('follows a chain past its last used address, so coins far along it are found', async () => {
    // used up to index 25, beyond the first 20 a fixed window would read
    const used = Array.from({ length: 26 }, (_, index) => chipnetAddress(0, index))
    chipnetChain({ used, funded: [chipnetAddress(0, 25)] })
    expect(await chipnetCopyState(chipnetHd)).toBe('holdsCoins')
  })

  it('reads the one address of a single-address copy', async () => {
    expect(await chipnetCopyState(`seed:testnet:${mnemonic}:m/44'/145'/0'/0/0`)).toBe('unused')
    expect(mockGetHistory.mock.calls).toEqual([[firstChipnetAddress]])
    chipnetChain({ used: [firstChipnetAddress], funded: [firstChipnetAddress] })
    expect(await chipnetCopyState(`seed:testnet:${mnemonic}:m/44'/145'/0'/0/0`)).toBe('holdsCoins')
  })

  it('counts a copy it cannot read as holding coins, and lets a failed lookup through', async () => {
    expect(await chipnetCopyState('wif:testnet:cPS12C2bpGHtKjS5NXNyWyTGGRMPk7D7pjp5JfgxRKWyFnWoDyZg')).toBe('holdsCoins')
    expect(await chipnetCopyState(`seed:testnet:${mnemonic}:m/44'/145'/0'/0'/0`)).toBe('holdsCoins')
    mockGetHistory.mockRejectedValue(new Error('server lost'))
    await expect(chipnetCopyState(chipnetHd)).rejects.toThrow('server lost')
  })
})

describe('removeEmptyChipnetCopy', () => {
  beforeEach(() => {
    mockGetNamedWalletId.mockReset()
    mockDeleteNamedWallet.mockReset()
    mockGetHistory.mockReset()
    mockGetUtxos.mockReset()
    chipnetChain({})
    storedIds({ bitcoincash: mainnetHd, bchtest: chipnetHd })
  })

  it('deletes the chipnet row only, for an unused copy and for a used one holding no coins', async () => {
    await removeEmptyChipnetCopy('w', chipnetHd)
    chipnetChain({ used: [firstChipnetAddress] })
    await removeEmptyChipnetCopy('w', chipnetHd)
    expect(mockDeleteNamedWallet).toHaveBeenCalledTimes(2)
    expect(mockDeleteNamedWallet).toHaveBeenCalledWith('w', 'bchtest')
  })

  it('deletes nothing when the chipnet row is not the copy that was checked', async () => {
    await expect(removeEmptyChipnetCopy('w', chipnetHd.replace('about', 'abandon'))).rejects.toThrow()
    storedIds({ bitcoincash: mainnetHd, bchtest: chipnetHd.replace('about', 'abandon') })
    await expect(removeEmptyChipnetCopy('w', chipnetHd)).rejects.toThrow()
    expect(mockDeleteNamedWallet).not.toHaveBeenCalled()
  })

  it('deletes nothing when the mainnet row is gone or holds other keys', async () => {
    storedIds({ bitcoincash: undefined, bchtest: chipnetHd })
    await expect(removeEmptyChipnetCopy('w', chipnetHd)).rejects.toThrow()
    storedIds({ bitcoincash: mainnetHd.replace('about', 'abandon'), bchtest: chipnetHd })
    await expect(removeEmptyChipnetCopy('w', chipnetHd)).rejects.toThrow()
    expect(mockDeleteNamedWallet).not.toHaveBeenCalled()
  })

  it('reads the rows again after the chipnet reads, so a row changed meanwhile is not deleted', async () => {
    // another tab deletes the wallet and makes a new chipnet wallet of that name during the reads
    mockGetHistory.mockImplementation(() => {
      storedIds({ bitcoincash: undefined, bchtest: chipnetHd.replace('about', 'abandon') })
      return Promise.resolve([])
    })
    await expect(removeEmptyChipnetCopy('w', chipnetHd)).rejects.toThrow()
    expect(mockDeleteNamedWallet).not.toHaveBeenCalled()
  })

  it('deletes nothing when the copy holds coins, or its coins cannot be read', async () => {
    chipnetChain({ used: [firstChipnetAddress], funded: [firstChipnetAddress] })
    await expect(removeEmptyChipnetCopy('w', chipnetHd)).rejects.toThrow()
    chipnetChain({ used: [firstChipnetAddress] })
    mockGetUtxos.mockRejectedValue(new Error('server lost'))
    await expect(removeEmptyChipnetCopy('w', chipnetHd)).rejects.toThrow('server lost')
    expect(mockDeleteNamedWallet).not.toHaveBeenCalled()
  })
})
