// Plausible web analytics — bundled via npm instead of a remote <script> tag
// to avoid third-party code loading in the wallet's origin context.
// Only runs for the production web wallet (not Electron or Capacitor).
import { init } from '@plausible-analytics/tracker'

if (import.meta.env.QUASAR_SPA_MODE && import.meta.env.QUASAR_PROD) {
  init({
    domain: 'cashonize.com',
    // Never report query params: deep links like ?uri=bch-wif:<WIF>
    // contain secrets that must not leave the device.
    // Note: this only covers analytics, the query still reaches the web host
    // and persists in browser history until stripped from the URL.
    transformRequest: (payload) => {
      const url = new URL(payload.u)
      payload.u = url.origin + url.pathname
      return payload
    },
  })
}
