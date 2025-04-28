import { boot } from 'quasar/wrappers'
import { getCurrentWindow } from '@tauri-apps/api/window'

export default boot(async () => {
  if (process.env.TAURI) {
    const currentWindow = getCurrentWindow();
    try {
      await currentWindow.maximize();
      setTimeout(async () => {
        await currentWindow.show();
      }, 150);
    } catch (error) {
      console.error('Error showing or maximizing window:', error);
    }
  }
})