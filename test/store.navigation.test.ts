import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Import mocks FIRST (before importing the store)
import { localStorageMock } from './mocks/store.mocks'

// Import store after mocks
import { useStore } from '../src/stores/store'

describe('navigation stack', () => {
  let store: ReturnType<typeof useStore>
  let pushStateSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    pushStateSpy = vi.fn()
    vi.stubGlobal('history', {
      pushState: pushStateSpy,
      replaceState: vi.fn(),
      back: vi.fn(),
      length: 1,
    })
    vi.clearAllMocks()
    localStorageMock.clear()
    setActivePinia(createPinia())
    store = useStore()
  })

  it('first changeView does not call pushState (avoids blank page on back)', () => {
    store.changeView(1)
    expect(store.displayView).toBe(1)
    expect(pushStateSpy).not.toHaveBeenCalled()
  })

  it('changeView with the same view consecutively is a no-op', () => {
    store.changeView(1)
    store.changeView(1)
    expect(store.canGoBack).toBe(false)
    expect(pushStateSpy).not.toHaveBeenCalled()
  })

  it('canGoBack reflects whether the view stack has history', () => {
    expect(store.canGoBack).toBe(false)

    store.changeView(1)
    expect(store.canGoBack).toBe(false)

    store.changeView(2)
    expect(store.canGoBack).toBe(true)

    dispatchEvent(new Event('popstate'))
    expect(store.canGoBack).toBe(false)
  })

  it('move-to-front deduplication produces correct back-navigation order', () => {
    store.changeView(1)
    store.changeView(2)
    store.changeView(5)
    store.changeView(2) // move 2 to front, stack: [1, 5, 2]

    dispatchEvent(new Event('popstate'))
    expect(store.displayView).toBe(5)

    dispatchEvent(new Event('popstate'))
    expect(store.displayView).toBe(1)
  })
})
