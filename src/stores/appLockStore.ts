// The app lock: an optional PIN asked when the app opens, after it sat in the background, and
// before what moves funds or shows the seed phrase.
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Dialog } from 'quasar'
import { freeAttempts, makePinRecord, maxDelayMs, pinMatches, retryDelayMs, type PinRecord } from 'src/utils/appLock'
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

  // Unlocking with a fingerprint or face instead of the PIN, an option on top of the PIN
  const biometrics = ref(biometricsSupported && enabled.value && localStorage.getItem(biometricsKey) === 'on')
  function setBiometrics(on: boolean) {
    if (on) localStorage.setItem(biometricsKey, 'on')
    else localStorage.removeItem(biometricsKey)
    biometrics.value = on
  }
  // The device's prompt, which a press of its button leaves for the PIN; false when not passed
  async function passBiometrics(title: string) {
    if (!biometrics.value) return false
    return await verifyBiometrics(title, t('appLock.usePin'))
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

  async function unlock(pin: string) {
    const matches = await checkPin(pin)
    if (matches) locked.value = false
    return matches
  }

  async function unlockWithBiometrics() {
    const passed = await passBiometrics(t('appLock.lockedTitleBiometrics'))
    if (passed) locked.value = false
    return passed
  }

  // Asks for the PIN in a dialog before something sensitive. Resolves true right away without a
  // lock, and false when the user backs out. With biometrics on, their prompt comes first and
  // leaving it opens the PIN dialog.
  async function confirmPin() {
    if (!enabled.value) return true
    if (await passBiometrics(t('appLock.confirmTitleBiometrics'))) return true
    // loaded here, so the stores asking for a PIN do not import a component
    const { default: pinDialog } = await import('src/components/general/pinDialog.vue')
    return new Promise<boolean>((resolve) => {
      Dialog.create({ component: pinDialog })
        .onOk(() => resolve(true))
        .onCancel(() => resolve(false))
        .onDismiss(() => resolve(false))
    })
  }

  return {
    enabled, locked, biometrics, retryAt, triesLeft,
    checkPin, setPin, removePin, setBiometrics, lock, unlock, unlockWithBiometrics, confirmPin,
  }
})
