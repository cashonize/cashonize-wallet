import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { useSettingsStore } from '../src/stores/settingsStore'

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
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {} })
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
