import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { useSettingsStore } from '../src/stores/settingsStore'
import { defaultWalletName } from '../src/stores/constants'

// the real settings store, not the stub the wallet-store tests share: what is tested here is
// what it reads from storage when it starts
vi.mock('src/utils/composables', () => ({
  useWindowSize: () => ({ width: ref(1000), height: ref(800) }),
}))

const stored: Record<string, string> = {}
const storage = {
  getItem: (key: string) => stored[key] ?? null,
  setItem: (key: string, value: string) => { stored[key] = value },
  removeItem: (key: string) => { delete stored[key] },
  clear: () => { for (const key of Object.keys(stored)) delete stored[key] },
}

describe('the setting that follows the identities of held tokens', () => {
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', storage)
    // the store reads the dark-mode media query and listens for the app being installed
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }), addEventListener: () => {} })
    setActivePinia(createPinia())
  })

  it('is off unless chosen', () => {
    expect(useSettingsStore().followTokenIdentities).toBe(false)
  })

  // the developer option that resolved every held token's authchain before the identities page
  // existed was used by the people who hold identities, which is who this setting serves; it is
  // written under the new key, since the store persists a setting only when the menu changes it
  it('carries the old authchains developer option over, under the new key', () => {
    storage.setItem('authchains', 'true')

    expect(useSettingsStore().followTokenIdentities).toBe(true)
    expect(storage.getItem('followTokenIdentities')).toBe('true')
    expect(storage.getItem('authchains')).toBeNull()
  })

  it('keeps a choice already made under the new key', () => {
    storage.setItem('authchains', 'true')
    storage.setItem('followTokenIdentities', 'false')

    expect(useSettingsStore().followTokenIdentities).toBe(false)
  })
})

describe('the default wallet name', () => {
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }), addEventListener: () => {} })
    setActivePinia(createPinia())
  })

  // wallets made before multi-wallet, and their per-wallet data, are stored under this name and
  // opened by it when no active wallet is saved: changing it would hide them
  it('stays the name existing wallets are stored under', () => {
    expect(defaultWalletName).toBe('mywallet')
  })

  it('receives the backup status of the old single-wallet setting', () => {
    storage.setItem('seedBackedUp', 'true')

    expect(useSettingsStore().getBackupStatus('mywallet')).toBe('verified')
    expect(storage.getItem('seedBackedUp')).toBeNull()
  })
})

describe('the retired option to mark addresses as used', () => {
  // the migration looks for the marks by their keys, so here the stored values are the storage's
  // own properties, as they are on the browser's
  class KeyedStorage {
    [key: string]: unknown
    getItem(key: string) { return Object.hasOwn(this, key) ? this[key] as string : null }
    setItem(key: string, value: string) { this[key] = value }
    removeItem(key: string) { delete this[key] }
  }
  let keyed: KeyedStorage

  beforeEach(() => {
    keyed = new KeyedStorage()
    vi.stubGlobal('localStorage', keyed)
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {} }), addEventListener: () => {} })
    setActivePinia(createPinia())
    keyed.setItem('addressMarks-mainnet-mywallet', '["bitcoincash:qq"]')
    keyed.setItem('addressLabels-mainnet-mywallet', '{}')
  })

  // marks were ignored while the option was off, and would otherwise start moving the receive
  // address on their own now that they always apply
  it('drops the marks that were being ignored with the option off', () => {
    keyed.setItem('enableAddressMarking', 'false')
    useSettingsStore()

    expect(keyed.getItem('addressMarks-mainnet-mywallet')).toBeNull()
    expect(keyed.getItem('addressLabels-mainnet-mywallet')).toBe('{}')
    expect(keyed.getItem('enableAddressMarking')).toBeNull()
  })

  it('keeps the marks of a wallet that had the option on', () => {
    keyed.setItem('enableAddressMarking', 'true')
    useSettingsStore()

    expect(keyed.getItem('addressMarks-mainnet-mywallet')).toBe('["bitcoincash:qq"]')
    expect(keyed.getItem('enableAddressMarking')).toBeNull()
  })

  it('leaves marks alone once the option is gone from storage', () => {
    useSettingsStore()

    expect(keyed.getItem('addressMarks-mainnet-mywallet')).toBe('["bitcoincash:qq"]')
  })
})
