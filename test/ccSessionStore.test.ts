import { describe, it, expect, vi, beforeEach } from 'vitest'
import { binToHex, hexToBin, secp256k1 } from '@bitauth/libauth'
import { LocalStorageStore } from '@cashconnect-js/nostr'
import type { WalletSession } from '@cashconnect-js/nostr/wallet'
import { sessionStoreForChain } from '../src/utils/dapp/ccSessionStore'

// LocalStorageStore lists its keys through length and key(i), which the shared mock lacks
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  get length() { return storage.size },
  key: (index: number) => [...storage.keys()][index] ?? null,
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
})

const privateKey = hexToBin('11'.repeat(32))
// written the way the library's default store does, with the public key derived independently,
// so a change to the namespace (which would drop every existing pairing) fails here
const defaultStore = new LocalStorageStore<WalletSession>(
  `bch-cc-v1:wallet-session:${binToHex(secp256k1.derivePublicKeyCompressed(privateKey) as Uint8Array)}:`
)

function session(dappPubkey: string, chain: WalletSession['chain']) {
  return { dappPubkey, chain, dapp: { name: dappPubkey, url: `https://${dappPubkey}.example` } } as WalletSession
}

describe('CashConnect sessions per network', () => {
  beforeEach(async () => {
    storage.clear()
    await defaultStore.set('mainnetDapp', session('mainnetDapp', 'bitcoincash'))
    await defaultStore.set('chipnetDapp', session('chipnetDapp', 'bchtest'))
  })

  it('restores on each network only the sessions paired there, from the existing pairings', async () => {
    expect(await sessionStoreForChain(privateKey, 'bitcoincash').list()).toEqual(['mainnetDapp'])
    expect(await sessionStoreForChain(privateKey, 'bchtest').list()).toEqual(['chipnetDapp'])
  })
})
