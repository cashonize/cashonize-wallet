// Biometric unlock, Android only: the system's fingerprint or face prompt as an alternative to
// typing the app lock's PIN, which stays the fallback. Like the PIN it is a gate in the interface:
// it shows the device's owner is present and decrypts nothing. The prompt is the app's own
// native plugin (BiometricPlugin.java), strong biometrics only.
interface BiometricPlugin {
  isAvailable(): Promise<{ available: boolean }>
  verify(options: { title: string, cancel: string }): Promise<{ verified: boolean }>
}

export const biometricsSupported = Boolean(import.meta.env.QUASAR_CAPACITOR_MODE)

// @capacitor/core is imported here on first use, not at the top of the file: the app lock imports
// this file on every platform, and loading @capacitor/core sets window.Capacitor, the global by
// which Quasar tells the Android app apart. Loaded up front, web and desktop builds would carry it
// too and stay correct only as long as Quasar happens to read the platform first.
// The plugin is registered without a web implementation, so off Android a call rejects. It is
// handed to `use` rather than returned: Capacitor's plugin proxy answers to `then`, so an async
// function returning it would never settle.
let biometric: BiometricPlugin | undefined
async function withPlugin<T>(use: (plugin: BiometricPlugin) => Promise<T>) {
  // Right in front of the import, where the bundler sees it and drops the import from web and
  // desktop builds: Quasar resolves @capacitor/core to src-capacitor/node_modules in every build
  // mode, which only exists where the Android project was installed
  if (!import.meta.env.QUASAR_CAPACITOR_MODE) throw new Error('Biometrics are Android only')
  const { registerPlugin } = await import('@capacitor/core')
  biometric ??= registerPlugin<BiometricPlugin>('Biometric')
  return await use(biometric)
}

// Whether the device has a strong fingerprint or face enrolled; its own PIN does not count
export async function biometricsAvailable() {
  if (!biometricsSupported) return false
  try {
    const result = await withPlugin(plugin => plugin.isAvailable())
    return result.available
  } catch {
    return false
  }
}

// One prompt at a time: a second one opened by a double tap shares the open prompt's result
let pending: Promise<boolean> | undefined

// True once the prompt was passed; false when it was cancelled, failed or could not be shown
export async function verifyBiometrics(title: string, cancel: string) {
  if (!biometricsSupported) return false
  pending ??= prompt(title, cancel).finally(() => { pending = undefined })
  return await pending
}

async function prompt(title: string, cancel: string) {
  try {
    const result = await withPlugin(plugin => plugin.verify({ title, cancel }))
    return result.verified
  } catch {
    return false
  }
}
