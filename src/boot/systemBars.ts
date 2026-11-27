import { defineBoot } from '#q-app'
import { watch } from 'vue'
import { SystemBars, SystemBarsStyle } from '@capacitor/core'
import { useSettingsStore } from 'src/stores/settingsStore'

// Android styles its system bars by the phone's theme, not the app's: on a light phone the dark
// theme got dark status icons on black, and a white scrim behind the three navigation buttons.
// A boot file of the Capacitor build only, as other builds cannot resolve Capacitor's packages.
export default defineBoot(({ store }) => {
  const settingsStore = useSettingsStore(store)
  watch(() => settingsStore.darkMode, (darkMode) => {
    const style = darkMode ? SystemBarsStyle.Dark : SystemBarsStyle.Light
    void SystemBars.setStyle({ style })
  }, { immediate: true })
})
