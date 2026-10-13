import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { useSettingsStore, settingsMenuKeys, removeSettingsMenuKeys } from '../src/stores/settingsStore'

// the real settings store: what is tested is which keys it reads from storage when it starts
vi.mock('src/utils/composables', () => ({
  useWindowSize: () => ({ width: ref(1000), height: ref(800) }),
}))

// Read by the store but left by a reset. The language is an option, but kept so the user can
// still read the app afterwards. The rest are not options on the settings pages: removing
// walletMetadata would make an HD wallet load as single-address, walletBackupStatus would bring
// the backup reminder back, and the rest are the token list's and history's own view state,
// device facts and migrated old keys.
const keptKeys = [
  "locale",
  "walletMetadata", "walletBackupStatus", "seedBackedUp",
  "featuredTokens", "hiddenTokens", "tokenDisplayFilter", "fiatValueHistory", "showBalanceInHistory",
  "qrScannerCameraId", "pwaInstalled",
  "hideBalanceColumn", "chaingraph", "authchains",
]

const stored: Record<string, string> = {}
const readKeys = new Set<string>()
const storage = {
  getItem: (key: string) => { readKeys.add(key); return stored[key] ?? null },
  setItem: (key: string, value: string) => { stored[key] = value },
  removeItem: (key: string) => { delete stored[key] },
  clear: () => { for (const key of Object.keys(stored)) delete stored[key] },
}

describe('resetting the settings', () => {
  beforeEach(() => {
    storage.clear()
    readKeys.clear()
    vi.stubGlobal('localStorage', storage)
    // the store reads the dark-mode media query and listens for the app being installed
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {} })
    vi.stubGlobal('document', { body: { classList: { add: () => {} } } })
    setActivePinia(createPinia())
  })

  // every key the store reads at startup has to be sorted into one list or the other, so a reset
  // does not silently miss an option or take state with it
  it('knows every key the store reads, as either reset or kept', () => {
    useSettingsStore()
    const unsorted = [...readKeys].filter(key =>
      !(settingsMenuKeys as readonly string[]).includes(key) && !keptKeys.includes(key))
    expect(unsorted).toEqual([])
  })

  it('only lists keys the store reads', () => {
    useSettingsStore()
    expect(settingsMenuKeys.filter(key => !readKeys.has(key))).toEqual([])
    expect(keptKeys.filter(key => !readKeys.has(key))).toEqual([])
  })

  it('brings the options back to their defaults and keeps the wallet state', () => {
    const defaults = useSettingsStore()
    const defaultCurrency = defaults.currency
    const defaultElectrum = defaults.electrumServerMainnet

    storage.setItem('currency', 'eur')
    storage.setItem('electrum-mainnet', 'electrum.example.org')
    storage.setItem('allowDappIdentitySpends', 'true')
    storage.setItem('walletMetadata', JSON.stringify({ mywallet: { walletType: 'hd' } }))
    storage.setItem('walletBackupStatus', JSON.stringify({ mywallet: 'verified' }))
    storage.setItem('hiddenTokens', JSON.stringify(['category1']))

    removeSettingsMenuKeys()
    setActivePinia(createPinia())
    const settingsStore = useSettingsStore()

    expect(settingsStore.currency).toBe(defaultCurrency)
    expect(settingsStore.electrumServerMainnet).toBe(defaultElectrum)
    expect(settingsStore.allowDappIdentitySpends).toBe(false)
    expect(settingsStore.getWalletType('mywallet')).toBe('hd')
    expect(settingsStore.getBackupStatus('mywallet')).toBe('verified')
    expect(settingsStore.hiddenTokens).toEqual(['category1'])
  })
})
