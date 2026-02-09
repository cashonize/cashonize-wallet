import { boot } from 'quasar/wrappers'
// @ts-ignore: @capacitor/app import gives TS error when dependency is not included
import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { Platform } from 'quasar'
import { useStore } from 'src/stores/store'

// TODO: investigate the need for 'App.getLaunchUrl()' for cold starts
// TODO: consider first doing 'await router.isReady()' before doing any router pushes

export default boot(( { router }) => {
  if(!Platform.is.capacitor) return
  void App.addListener('appUrlOpen', function (event: URLOpenListenerEvent) {
    // Use router.push to navigate without a hard-refresh (redirect)
    void router.push({ path: '/', query:{uri: event.url} });
  });
  void App.addListener('backButton', () => {
    const store = useStore();
    if (store.canGoBack) {
      history.back();
    } else {
      void App.exitApp();
    }
  });
})
