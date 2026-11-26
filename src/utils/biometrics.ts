// Biometric unlock, Android only: the system's fingerprint or face prompt as an alternative to
// typing the app lock's PIN, which stays the fallback. Like the PIN it is a gate in the interface:
// it shows the device's owner is present and decrypts nothing. The prompt is the app's own
// native plugin (BiometricPlugin.java), strong biometrics only.
export interface BiometricPlugin {
  isAvailable(): Promise<{ available: boolean }>
  verify(options: { title: string, cancel: string }): Promise<{ verified: boolean }>
}

// Handed over by the Capacitor-only boot file (src/boot/biometrics.ts), so this file, which the
// app lock loads on every platform, imports nothing from Capacitor
let biometric: BiometricPlugin | undefined
export function setBiometricPlugin(plugin: BiometricPlugin) {
  biometric = plugin
}

export const biometricsSupported = Boolean(import.meta.env.QUASAR_CAPACITOR_MODE)

// Whether the device has a strong fingerprint or face enrolled; its own PIN does not count
export async function biometricsAvailable() {
  if (!biometric) return false
  try {
    const result = await biometric.isAvailable()
    return result.available
  } catch {
    return false
  }
}

// One prompt at a time: a second one opened by a double tap shares the open prompt's result
let pending: Promise<boolean> | undefined

// True once the prompt was passed; false when it was cancelled, failed or could not be shown
export async function verifyBiometrics(title: string, cancel: string) {
  if (!biometric) return false
  pending ??= prompt(biometric, title, cancel).finally(() => { pending = undefined })
  return await pending
}

async function prompt(plugin: BiometricPlugin, title: string, cancel: string) {
  try {
    const result = await plugin.verify({ title, cancel })
    return result.verified
  } catch {
    return false
  }
}
