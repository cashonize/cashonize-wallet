// The app lock: an optional PIN asked when the app opens, after it sat in the background, and
// before what moves funds or shows the seed phrase.
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Dialog } from 'quasar'
import { autoLockMs, freeAttempts, makePinRecord, maxDelayMs, pinMatches, retryDelayMs, type PinRecord } from 'src/utils/appLock'
import { biometricsSupported, verifyBiometrics } from 'src/utils/biometrics'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

const pinKey = 'appLock'
const attemptsKey = 'appLockAttempts'
const biometricsKey = 'appLockBiometrics'
interface Attempts { failed: number, retryAt: number }

export const useAppLockStore = defineStore('appLock', () => {
  const pinRecord = ref<PinRecord | undefined>()
  const storedPin = localStorage.getItem(pinKey)
  if (storedPin) pinRecord.value = JSON.parse(storedPin) as PinRecord

  const enabled = computed(() => pinRecord.value !== undefined)
  const locked = ref(enabled.value)
  // When the app was last unlocked: with the PIN, or in the extension by another of its pages
  const unlockedAt = ref(Date.now())
  // When the app went out of sight. Away for autoLockMs it locks, before it is back in view too, so
  // auto-approval stops then. App.vue counts it for its page, the extension for all its pages.
  const awaySince = ref<number>()
  // whether a PIN is being asked in a dialog, which a withdrawn request takes with it
  const openPinDialogs = ref(0)
  const confirming = computed(() => openPinDialogs.value > 0)

  // Unlocking with a fingerprint or face instead of the PIN, an option on top of the PIN
  const biometrics = ref(biometricsSupported && enabled.value && localStorage.getItem(biometricsKey) === 'on')
  function setBiometrics(on: boolean) {
    if (on) localStorage.setItem(biometricsKey, 'on')
    else localStorage.removeItem(biometricsKey)
    biometrics.value = on
  }
  // The device's prompt, which a press of its button leaves for the PIN; false when not passed.
  // Passing it shows the owner is there, so it also clears the wrong PINs typed before.
  async function passBiometrics(title: string) {
    if (!biometrics.value) return false
    const passed = await verifyBiometrics(title, t('appLock.usePin'))
    if (passed) saveAttempts({ failed: 0, retryAt: 0 })
    return passed
  }

  // Kept in storage, so that reloading the app does not hand out fresh tries, and read again
  // before each try, as another tab may have used some. A wait further off than the longest one
  // comes from a clock set back since, and is cut to it.
  const attempts = ref<Attempts>({ failed: 0, retryAt: 0 })
  function readAttempts() {
    const stored = localStorage.getItem(attemptsKey)
    const read = stored ? JSON.parse(stored) as Attempts : { failed: 0, retryAt: 0 }
    attempts.value = { failed: read.failed, retryAt: Math.min(read.retryAt, Date.now() + maxDelayMs) }
  }
  readAttempts()
  function saveAttempts(next: Attempts) {
    attempts.value = next
    localStorage.setItem(attemptsKey, JSON.stringify(next))
  }
  const retryAt = computed(() => attempts.value.retryAt)
  // the wrong tries still free of a wait
  const triesLeft = computed(() => Math.max(0, freeAttempts - attempts.value.failed))

  // False for a wrong PIN and during the wait after too many of them
  async function checkPin(pin: string) {
    if (!pinRecord.value) return true
    readAttempts()
    if (Date.now() < attempts.value.retryAt) return false
    const matches = await pinMatches(pin, pinRecord.value)
    if (matches) {
      saveAttempts({ failed: 0, retryAt: 0 })
    } else {
      const failed = attempts.value.failed + 1
      saveAttempts({ failed, retryAt: Date.now() + retryDelayMs(failed) })
    }
    return matches
  }

  async function setPin(pin: string) {
    const record = await makePinRecord(pin)
    localStorage.setItem(pinKey, JSON.stringify(record))
    pinRecord.value = record
  }

  function removePin() {
    localStorage.removeItem(pinKey)
    localStorage.removeItem(attemptsKey)
    setBiometrics(false)
    pinRecord.value = undefined
    locked.value = false
  }

  function lock() {
    if (enabled.value) locked.value = true
  }

  function lockIfAway() {
    if (awaySince.value !== undefined && Date.now() - awaySince.value >= autoLockMs) lock()
  }

  async function unlock(pin: string) {
    const matches = await checkPin(pin)
    if (matches) {
      unlockedAt.value = Date.now()
      locked.value = false
    }
    return matches
  }

  async function unlockWithBiometrics() {
    const passed = await passBiometrics(t('appLock.lockedTitleBiometrics'))
    if (passed) {
      unlockedAt.value = Date.now()
      locked.value = false
    }
    return passed
  }

  // The extension's pages share one unlock (utils/bex/sharedUnlock.ts): a page takes over the one
  // another page holds, and when it began, without the PIN
  function resumeUnlock(since: number) {
    if (!locked.value) return
    unlockedAt.value = since
    locked.value = false
  }

  // Auto-approval signs a dApp's request without asking, which the lock must stop: not while
  // locked, nor once unlocked for a request sent before. Anyone at the device can make a dApp send
  // one, and the PIN approves nothing the user has not seen.
  function allowsAutoApproval(sentAt: number) {
    if (!enabled.value) return true
    lockIfAway()
    return !locked.value && sentAt >= unlockedAt.value
  }

  // Asks for the PIN in a dialog before something sensitive. Resolves true right away without a
  // lock, and false when the user backs out. With biometrics on, their prompt comes first and
  // leaving it opens the PIN dialog; changing or removing the lock itself asks for the typed PIN,
  // so a fingerprint enrolled on the device since cannot replace it. False too once `withdrawn`
  // aborts: what the PIN was asked for went away, a request its dApp withdrew say, and a PIN or
  // fingerprint given after cannot approve it.
  async function confirmPin(allowBiometrics = true, withdrawn?: AbortSignal) {
    if (!enabled.value) return true
    // not behind the lock screen, whose own prompt would answer for both
    if (allowBiometrics && !locked.value && biometrics.value) {
      openPinDialogs.value++
      let passed: boolean
      try {
        passed = await passBiometrics(t('appLock.confirmTitleBiometrics'))
      } finally {
        openPinDialogs.value--
      }
      if (passed) return !withdrawn?.aborted
    }
    // loaded here, so the stores asking for a PIN do not import a component
    const { default: pinDialog } = await import('src/components/general/pinDialog.vue')
    if (withdrawn?.aborted) return false
    openPinDialogs.value++
    return new Promise<boolean>((resolve) => {
      let settled = false
      const settle = (confirmed: boolean) => {
        if (settled) return
        settled = true
        openPinDialogs.value--
        withdrawn?.removeEventListener('abort', onWithdrawn)
        resolve(confirmed)
      }
      const handle = Dialog.create({ component: pinDialog })
        .onOk(() => settle(true))
        .onCancel(() => settle(false))
        .onDismiss(() => settle(false))
      function onWithdrawn() {
        settle(false)
        handle.hide()
      }
      withdrawn?.addEventListener('abort', onWithdrawn)
    })
  }

  return {
    enabled, locked, biometrics, unlockedAt, awaySince, confirming, retryAt, triesLeft,
    checkPin, setPin, removePin, setBiometrics, lock, lockIfAway, unlock, unlockWithBiometrics, resumeUnlock,
    allowsAutoApproval, confirmPin,
  }
})
