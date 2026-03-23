// Plausible web analytics — bundled via npm instead of a remote <script> tag
// to avoid third-party code loading in the wallet's origin context.
// Only runs for the production web wallet (not Electron or Capacitor).
import { init } from '@plausible-analytics/tracker'

if (process.env.MODE === 'spa' && process.env.PROD) {
  init({
    domain: 'cashonize.com',
  })
}
