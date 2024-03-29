
import { boot } from 'quasar/wrappers'
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Platform } from 'quasar'

export default boot(async ( { redirect  }) => {
  if(Platform.is.capacitor) {
    App.addListener('appUrlOpen', function (event: URLOpenListenerEvent) {
      redirect({ path: '/' , query:{uri: event.url}})
    });
  }
})