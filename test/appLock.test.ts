import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { autoLockMs, isValidPin, makePinRecord, pinMatches, retryDelayMs } from '../src/utils/appLock'
import { useAppLockStore } from '../src/stores/appLockStore'
import { BEX_LOCKED_AT_KEY, BEX_UNLOCK_KEY, sharedUnlockFrom, sharedUnlockLive } from '../src/utils/bex/sharedUnlock'

vi.mock('quasar', () => ({ Dialog: { create: vi.fn() } }))

describe('isValidPin', () => {
  it.each(['1234', '000000', '12345678'])('takes %s', (pin) => {
    expect(isValidPin(pin)).toBe(true)
  })
  // too short, too long, and anything that is not a digit, a full-width one included
  it.each(['', '123', '123456789', '12a4', '12 34', '１２３４', '-1234'])('refuses "%s"', (pin) => {
    expect(isValidPin(pin)).toBe(false)
  })
})

describe('the stored PIN', () => {
  it('matches the PIN it was made from and no other', async () => {
    const record = await makePinRecord('4821')
    expect(await pinMatches('4821', record)).toBe(true)
    expect(await pinMatches('4822', record)).toBe(false)
    // a PIN that only starts the same
    expect(await pinMatches('48210', record)).toBe(false)
  })

  it('holds neither the PIN nor the same hash twice for one PIN', async () => {
    const first = await makePinRecord('4821')
    const second = await makePinRecord('4821')
    expect(JSON.stringify(first)).not.toContain('4821')
    expect(first.salt).not.toBe(second.salt)
    expect(first.hash).not.toBe(second.hash)
  })

  it('refuses to store a PIN that is not one', async () => {
    await expect(makePinRecord('12')).rejects.toThrow()
  })

  // a record written with other parameters keeps verifying after the default changes
  it('verifies with the iterations the record names', async () => {
    const record = await makePinRecord('4821')
    expect(await pinMatches('4821', { ...record, iterations: record.iterations + 1 })).toBe(false)
  })
})

describe('retryDelayMs', () => {
  it('lets the first tries through without a wait', () => {
    for (let failed = 0; failed < 5; failed++) expect(retryDelayMs(failed)).toBe(0)
  })
  it('doubles the wait from half a minute up to a quarter of an hour', () => {
    expect(retryDelayMs(5)).toBe(30_000)
    expect(retryDelayMs(6)).toBe(60_000)
    expect(retryDelayMs(7)).toBe(120_000)
    expect(retryDelayMs(10)).toBe(15 * 60_000)
    expect(retryDelayMs(1000)).toBe(15 * 60_000)
  })
})

describe('auto-approval under the app lock', () => {
  const pin = '2468'
  let stored: Record<string, string>

  beforeEach(async () => {
    const record = JSON.stringify(await makePinRecord(pin))
    stored = { appLock: record }
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored[key] ?? null,
      setItem: (key: string, value: string) => { stored[key] = value },
      removeItem: (key: string) => { delete stored[key] },
    })
    setActivePinia(createPinia())
  })

  it('approves nothing while locked, nor once unlocked what was sent before the unlock', async () => {
    const appLock = useAppLockStore()
    const sentWhileLocked = Date.now()
    expect(appLock.allowsAutoApproval(sentWhileLocked)).toBe(false)

    await new Promise(resolve => setTimeout(resolve, 5))
    expect(await appLock.unlock(pin)).toBe(true)
    expect(appLock.allowsAutoApproval(sentWhileLocked)).toBe(false)
    expect(appLock.allowsAutoApproval(Date.now())).toBe(true)

    appLock.lock()
    expect(appLock.allowsAutoApproval(Date.now())).toBe(false)
  })

  it('locks once out of sight for the auto-lock time, before coming back into view', async () => {
    const appLock = useAppLockStore()
    await appLock.unlock(pin)
    appLock.awaySince = Date.now() - autoLockMs + 60_000
    expect(appLock.allowsAutoApproval(Date.now())).toBe(true)
    appLock.awaySince = Date.now() - autoLockMs
    expect(appLock.allowsAutoApproval(Date.now())).toBe(false)
    expect(appLock.locked).toBe(true)
  })

  // an extension page taking over the unlock of another page
  it('keeps when a resumed unlock began', () => {
    const appLock = useAppLockStore()
    const unlockedElsewhere = Date.now() - 60_000
    appLock.resumeUnlock(unlockedElsewhere)
    expect(appLock.locked).toBe(false)
    expect(appLock.allowsAutoApproval(unlockedElsewhere - 1)).toBe(false)
    expect(appLock.allowsAutoApproval(unlockedElsewhere)).toBe(true)
  })

  it('approves as before without a PIN', () => {
    stored = {}
    setActivePinia(createPinia())
    expect(useAppLockStore().allowsAutoApproval(0)).toBe(true)
  })
})

describe('the unlock the extension\'s pages share', () => {
  const unlock = { unlockedAt: 1_000, seenAt: 5_000 }

  it('is ended by a lock after it, and by nothing before it', () => {
    expect(sharedUnlockFrom({ [BEX_UNLOCK_KEY]: unlock, [BEX_LOCKED_AT_KEY]: 999 })).toEqual(unlock)
    expect(sharedUnlockFrom({ [BEX_UNLOCK_KEY]: unlock, [BEX_LOCKED_AT_KEY]: 1_000 })).toBeUndefined()
    expect(sharedUnlockFrom({ [BEX_UNLOCK_KEY]: { unlockedAt: 1_000 } })).toBeUndefined()
  })

  it('lives for the auto-lock time after a page was last in sight, not for a clock set back', () => {
    expect(sharedUnlockLive(unlock, unlock.seenAt + autoLockMs - 1)).toBe(true)
    expect(sharedUnlockLive(unlock, unlock.seenAt + autoLockMs)).toBe(false)
    expect(sharedUnlockLive(unlock, unlock.seenAt - 1)).toBe(false)
  })
})
