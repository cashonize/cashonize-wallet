import { defineBoot } from '#q-app'
import { registerPlugin } from '@capacitor/core'
import { setBiometricPlugin, type BiometricPlugin } from 'src/utils/biometrics'

// The app lock's fingerprint or face prompt, the app's own native plugin (BiometricPlugin.java),
// registered without a web implementation. A boot file of the Capacitor build only, as other
// builds cannot resolve Capacitor's packages (see AGENTS.md).
export default defineBoot(() => {
  setBiometricPlugin(registerPlugin<BiometricPlugin>('Biometric'))
})
