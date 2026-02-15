import { boot } from 'quasar/wrappers'
// @ts-ignore: @capacitor/app import gives TS error when dependency is not included
import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { Platform } from 'quasar'
import { useStore } from 'src/stores/store'

// Deep linking on mobile: handles URIs like bitcoincash:, wc:, cc:, bch-wif:
// These arrive via two paths depending on whether the app was already running:
//   - "warm start": app is in background, appUrlOpen event fires
//   - "cold start": app was not running, the launch URL is retrieved after startup
export default boot(async ( { router }) => {
  if(!Platform.is.capacitor) return

  // Wait for router to be fully initialized before pushing any routes
  await router.isReady();

  // Warm start: user taps a deep link while the app is already open in the background
  void App.addListener('appUrlOpen', function (event: URLOpenListenerEvent) {
    void router.push({ path: '/', query:{uri: event.url} });
  });

  // Cold start: user taps a deep link that launches the app from scratch
  // The appUrlOpen listener above won't catch this, so we check the launch URL separately
  const launchUrl = await App.getLaunchUrl();
  if (launchUrl?.url) {
    void router.push({ path: '/', query:{uri: launchUrl.url} });
  }

  void App.addListener('backButton', () => {
    const store = useStore();
    if (store.canGoBack) {
      history.back();
    } else {
      void App.exitApp();
    }
  });
})
