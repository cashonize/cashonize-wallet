// Biometric unlock, Android only: the system's fingerprint or face prompt as an alternative to
// typing the app lock's PIN, which stays the fallback. Like the PIN it is a gate in the interface:
// it shows the device's owner is present and decrypts nothing. The plugin's web build reports
// success for anything, so it is only ever asked inside the native app.
import { Capacitor } from '@capacitor/core'

export const biometricsSupported = Capacitor.isNativePlatform()

// loaded on use, so the web and desktop bundles never carry the plugin's stub
async function plugin() {
  const { NativeBiometric } = await import('@capgo/capacitor-native-biometric')
  return NativeBiometric
}

// Whether the device has a fingerprint or face enrolled; the device's own PIN does not count
export async function biometricsAvailable() {
  if (!biometricsSupported) return false
  try {
    const nativeBiometric = await plugin()
    const result = await nativeBiometric.isAvailable({ useFallback: false })
    return result.isAvailable
  } catch {
    return false
  }
}

// True once the prompt was passed; false when it was cancelled, failed or could not be shown
export async function verifyBiometrics(title: string, negativeButtonText: string) {
  if (!biometricsSupported) return false
  try {
    const nativeBiometric = await plugin()
    // the prompt's own tries before it gives up, five being Android's maximum
    await nativeBiometric.verifyIdentity({ title, negativeButtonText, maxAttempts: 5 })
    return true
  } catch {
    return false
  }
}
