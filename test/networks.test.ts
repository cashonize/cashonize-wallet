import { describe, it, expect } from 'vitest'
import { getTransactionHash, networkConfig } from '@cashonize/bch-wallet-lib'
import { appNetworkOf, appNetworks, libraryNetwork, walletDbName } from '../src/utils/wallet/networks'

describe('the app networks', () => {
  it('map to the library networks both ways, testnet4 never falling back to chipnet', () => {
    for (const network of appNetworks) expect(appNetworkOf(libraryNetwork(network))).toBe(network)
    expect(libraryNetwork('chipnet')).toBe('testnet')
    expect(appNetworkOf('testnet4')).toBe('testnet4')
    expect(() => appNetworkOf('regtest')).toThrow()
  })

  it('keep each network in a database of its own', () => {
    expect(appNetworks.map(walletDbName)).toEqual(['bitcoincash', 'bchtest', 'bchtest4'])
  })

  it('register testnet4 with a block after chipnet split off as its checkpoint', async () => {
    const testnet4 = networkConfig('testnet4')
    expect(testnet4.addressPrefix).toBe('bchtest')
    expect(testnet4.keyVersion).toBe('testnet')
    // the header testnet4 servers serve at the checkpoint; a chipnet server's differs there
    const header = '00000020dd4d488b15505869869b92f040ecacbdd63354f0dbc0d4d123247501000000003add46d53f982a57269eb3028046235a27adce112b26f9142d123f98a8df0e05c1233567977e281ca18dda27'
    expect(testnet4.chain?.checkpoint?.height).toBe(227000)
    expect(await getTransactionHash(header)).toBe(testnet4.chain?.checkpoint?.hash)
    // what keeps a chipnet server from being taken for testnet4: chipnet's block there differs
    expect(networkConfig('testnet').chain?.checkpoint?.height).toBe(227000)
    expect(networkConfig('testnet').chain?.checkpoint?.hash).not.toBe(testnet4.chain?.checkpoint?.hash)
  })
})
