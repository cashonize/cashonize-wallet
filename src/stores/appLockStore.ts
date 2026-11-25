// The app lock: an optional PIN asked when the app opens, after it sat in the background, and
// before what moves funds or shows the seed phrase. Android and web only; the desktop app has none.
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Dialog } from 'quasar'
import { makePinRecord, pinMatches, retryDelayMs, type PinRecord } from 'src/utils/appLock'

const pinKey = 'appLock'
const attemptsKey = 'appLockAttempts'
interface Attempts { failed: number, retryAt: number }

export const useAppLockStore = defineStore('appLock', () => {
  const isSupported = !import.meta.env.QUASAR_ELECTRON_MODE

  const pinRecord = ref<PinRecord | undefined>()
  const storedPin = localStorage.getItem(pinKey)
  if (isSupported && storedPin) pinRecord.value = JSON.parse(storedPin) as PinRecord

  const enabled = computed(() => pinRecord.value !== undefined)
  const locked = ref(enabled.value)

  // kept in storage, so that reloading the app does not hand out fresh tries
  const attempts = ref<Attempts>({ failed: 0, retryAt: 0 })
  const storedAttempts = localStorage.getItem(attemptsKey)
  if (storedAttempts) attempts.value = JSON.parse(storedAttempts) as Attempts
  function saveAttempts(next: Attempts) {
    attempts.value = next
    localStorage.setItem(attemptsKey, JSON.stringify(next))
  }
  const retryAt = computed(() => attempts.value.retryAt)

  // False for a wrong PIN and during the wait after too many of them
  async function checkPin(pin: string) {
    if (!pinRecord.value) return true
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
    pinRecord.value = undefined
    locked.value = false
  }

  function lock() {
    if (enabled.value) locked.value = true
  }

  async function unlock(pin: string) {
    const matches = await checkPin(pin)
    if (matches) locked.value = false
    return matches
  }

  // Asks for the PIN in a dialog before something sensitive. Resolves true right away without a
  // lock, and false when the user backs out.
  async function confirmPin() {
    if (!enabled.value) return true
    // loaded here, so the stores asking for a PIN do not import a component
    const { default: pinDialog } = await import('src/components/general/pinDialog.vue')
    return new Promise<boolean>((resolve) => {
      Dialog.create({ component: pinDialog })
        .onOk(() => resolve(true))
        .onCancel(() => resolve(false))
        .onDismiss(() => resolve(false))
    })
  }

  return { isSupported, enabled, locked, retryAt, checkPin, setPin, removePin, lock, unlock, confirmPin }
})
