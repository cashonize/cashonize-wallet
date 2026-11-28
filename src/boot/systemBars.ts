import { defineBoot } from '#q-app'
import { watch } from 'vue'
import { registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { useSettingsStore } from 'src/stores/settingsStore'

interface WindowBackgroundPlugin {
  setColor(options: { color: string }): Promise<void>
}
const windowBackground = registerPlugin<WindowBackgroundPlugin>('WindowBackground')

// Android styles its system bars by the phone's theme, not the app's: the app's theme sets their
// icons and the window colour behind them (WindowBackgroundPlugin.java)
export default defineBoot(({ store }) => {
  const settingsStore = useSettingsStore(store)
  watch(() => [settingsStore.themeMode, settingsStore.darkMode], async () => {
    const style = settingsStore.darkMode ? SystemBarsStyle.Dark : SystemBarsStyle.Light
    // setStyle repaints the window in the phone theme's colour, so ours goes on after it
    await SystemBars.setStyle({ style })
    const color = getComputedStyle(document.body).getPropertyValue('--bg-color').trim()
    await windowBackground.setColor({ color })
  }, { immediate: true })
})
