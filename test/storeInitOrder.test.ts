// store.ts reads the settings at module scope, so any module settingsStore imports must not
// import a store back. When that cycle exists, whichever store a component happens to import
// first decides whether the app boots at all, and entering at settingsStore throws.
import { describe, it, expect, vi } from 'vitest'

describe('store module init order', () => {
  it('evaluates settingsStore first without reaching a store through its own imports', async () => {
    // settingsStore calls useWindowSize while it initialises
    vi.stubGlobal('window', { innerWidth: 1024, innerHeight: 768, addEventListener() {}, removeEventListener() {} })
    const settingsStore = await import('../src/stores/settingsStore')
    expect(typeof settingsStore.useSettingsStore).toBe('function')
  })
})
