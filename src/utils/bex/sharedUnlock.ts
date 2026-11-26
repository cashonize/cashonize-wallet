// The extension's pages are one app to the user, under one app lock. Unlocked in any of its pages,
// the extension stays unlocked while one of them is in sight and for the auto-lock time after the
// last one went out of sight, the web app's timer for its page: the toolbar popup or an approval
// window opening then opens unlocked. A lock in one page locks them all. Kept in storage.session,
// which only the extension's pages and worker read, and which the browser clears when it closes.
import { watch } from 'vue'
import { autoLockMs } from 'src/utils/appLock'
import { useAppLockStore } from 'src/stores/appLockStore'

export const BEX_UNLOCK_KEY = 'bexUnlock'
// a key of its own, so a page still writing the unlock cannot overwrite a lock made meanwhile
export const BEX_LOCKED_AT_KEY = 'bexLockedAt'
// how often a page in sight says so, well inside the auto-lock time
const SEEN_INTERVAL_MS = 30_000

export interface SharedUnlock {
  // when the PIN was typed; a request sent before it gets no auto-approval
  unlockedAt: number
  // when an unlocked page was last in sight
  seenAt: number
}

// The unlock the stored items hold, unless a lock came after it
export function sharedUnlockFrom(items: Record<string, unknown>): SharedUnlock | undefined {
  const unlock = items[BEX_UNLOCK_KEY] as Partial<SharedUnlock> | undefined
  if (typeof unlock?.unlockedAt !== 'number' || typeof unlock.seenAt !== 'number') return undefined
  const lockedAt = items[BEX_LOCKED_AT_KEY]
  if (typeof lockedAt === 'number' && lockedAt >= unlock.unlockedAt) return undefined
  return { unlockedAt: unlock.unlockedAt, seenAt: unlock.seenAt }
}

// Live while a page was in sight within the auto-lock time; a clock set back since ends it
export function sharedUnlockLive(shared: SharedUnlock | undefined, now: number): shared is SharedUnlock {
  if (!shared) return false
  const away = now - shared.seenAt
  return away >= 0 && away < autoLockMs
}

// Run once per page, before the app mounts, so a page opening while the extension is unlocked
// shows no lock screen
export async function shareUnlockAcrossPages() {
  const appLock = useAppLockStore()
  const items: Record<string, unknown> = {}
  try {
    Object.assign(items, await chrome.storage.session.get([BEX_UNLOCK_KEY, BEX_LOCKED_AT_KEY]))
  } catch {
    // unreadable: the page keeps the lock it started with
  }

  // This page follows the extension: unlocked while the shared unlock lives, locked once it lapsed.
  // Out of sight, the page is away since the last page was in sight, which the app lock checks
  // before an auto-approval.
  function follow() {
    const shared = sharedUnlockFrom(items)
    if (sharedUnlockLive(shared, Date.now())) {
      appLock.resumeUnlock(shared.unlockedAt)
    } else {
      appLock.lock()
    }
    appLock.awaySince = document.hidden ? shared?.seenAt : undefined
  }

  // kept locally first, so this page reads its own write before the change event comes back
  function write(update: Record<string, unknown>) {
    Object.assign(items, update)
    chrome.storage.session.set(update).catch(() => {})
  }

  function sayInSight() {
    if (!appLock.enabled || appLock.locked) return
    const unlock: SharedUnlock = { unlockedAt: appLock.unlockedAt, seenAt: Date.now() }
    write({ [BEX_UNLOCK_KEY]: unlock })
  }

  follow()
  watch(() => appLock.locked, (locked) => {
    if (locked) write({ [BEX_LOCKED_AT_KEY]: Date.now() })
    else sayInSight()
  })
  // a PIN set in this page makes its unlock the extension's
  watch(() => appLock.enabled, sayInSight)

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session') return
    const keys = [BEX_UNLOCK_KEY, BEX_LOCKED_AT_KEY].filter(key => key in changes)
    if (!keys.length) return
    for (const key of keys) {
      const value = changes[key]?.newValue
      if (value === undefined) delete items[key]
      else items[key] = value
    }
    follow()
  })

  document.addEventListener('visibilitychange', () => {
    // the time away counts from the moment the page went out of sight
    if (document.hidden) sayInSight()
    follow()
    if (!document.hidden) sayInSight()
  })
  setInterval(() => {
    if (!document.hidden) sayInSight()
  }, SEEN_INTERVAL_MS)
}
