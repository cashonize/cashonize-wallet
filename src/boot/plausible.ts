// Plausible web analytics: one pageview per load, sent by the app itself rather than through
// Plausible's tracker, so no third-party code runs in the wallet's origin.
// Only runs for the production web wallet (not Electron or Capacitor).
// API: https://plausible.io/docs/events-api

if (import.meta.env.QUASAR_SPA_MODE && import.meta.env.QUASAR_PROD) {
  // the tracker's own opt-outs: automated browsers, a prod build previewed locally, and a
  // device excluded via localStorage
  let optedOut = navigator.webdriver || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  try {
    optedOut ||= localStorage.getItem('plausible_ignore') === 'true';
  } catch {
    // storage unavailable, nothing to read
  }
  if (!optedOut) {
    void fetch('https://plausible.io/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        name: 'pageview',
        domain: 'cashonize.com',
        // Never report the query or hash: deep links like ?uri=bch-wif:<WIF> contain secrets
        // that must not leave the device. The query still reaches the web host and persists in
        // browser history until stripped from the URL.
        url: location.origin + location.pathname,
        // the referring site's origin only, which is all the sources report needs
        referrer: document.referrer ? new URL(document.referrer).origin : null,
      }),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {});
  }
}
