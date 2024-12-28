import { boot } from 'quasar/wrappers'
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Platform } from 'quasar'

export default boot(async ( { router }) => {
  if(Platform.is.capacitor) {
    App.addListener('appUrlOpen', function (event: URLOpenListenerEvent) {
      // Use router.push to navigate without a hard-refresh (redirect)
      router.push({ path: '/', query:{uri: event.url} });
    });
  }
})