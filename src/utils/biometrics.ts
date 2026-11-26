// Biometric unlock, Android only: the system's fingerprint or face prompt as an alternative to
// typing the app lock's PIN, which stays the fallback. Like the PIN it is a gate in the interface:
// it shows the device's owner is present and decrypts nothing. The plugin's web build reports
// success for anything, so it is only ever asked inside the native app.
export const biometricsSupported = Boolean(import.meta.env.QUASAR_CAPACITOR_MODE)

// The module rather than the plugin: Capacitor's plugin proxy answers to `then`, so an async
// function returning it would never settle
async function pluginModule() {
  return await import('@capgo/capacitor-native-biometric')
}

// Whether the device has a strong fingerprint or face enrolled; its own PIN does not count
export async function biometricsAvailable() {
  if (!biometricsSupported) return false
  try {
    const { NativeBiometric } = await pluginModule()
    const result = await NativeBiometric.isAvailable({ useFallback: false })
    return result.strongBiometryIsAvailable
  } catch {
    return false
  }
}

// One prompt at a time: the plugin keeps a single pending call, and a second prompt opened by a
// double tap would take the first one's result and leave the other call waiting for ever
let pending: Promise<boolean> | undefined

// True once the prompt was passed; false when it was cancelled, failed or could not be shown
export async function verifyBiometrics(title: string, negativeButtonText: string) {
  if (!biometricsSupported) return false
  pending ??= prompt(title, negativeButtonText).finally(() => { pending = undefined })
  return await pending
}

async function prompt(title: string, negativeButtonText: string) {
  try {
    const { NativeBiometric, BiometryType } = await pluginModule()
    await NativeBiometric.verifyIdentity({
      title,
      negativeButtonText,
      // Android's strong class only, which the plugin's FINGERPRINT type stands for: it covers a
      // face unlock rated strong too, while a weak face unlock from a camera image stays out
      allowedBiometryTypes: [BiometryType.FINGERPRINT],
      // the prompt's own tries before it gives up, five being Android's maximum
      maxAttempts: 5,
    })
    return true
  } catch {
    return false
  }
}
