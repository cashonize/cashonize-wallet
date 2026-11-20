import { defineBoot } from '#q-app'

// Preload the header logo and landing-view icons to improve initial page load. A boot file rather
// than an inline script in index.html, which the extension's Manifest V3 CSP forbids.
export default defineBoot(() => {
  // Mirrors the dark-mode startup logic in settingsStore.ts
  const storedDarkMode = localStorage.getItem('darkMode')
  const darkMode = storedDarkMode === 'true' ||
    (storedDarkMode === null && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // These public/ assets are referenced from Vue templates, so the browser can't discover them
  // until the app renders, which is gated on wallet initialization (Suspense around WalletPage).
  const images = [darkMode ? 'images/cashonize-logo-dark.png' : 'images/cashonize-logo.png']
  // activeWalletName is set on wallet create/import: present means the wallet view,
  // absent means onboarding
  if (localStorage.getItem('activeWalletName')) {
    images.push(
      darkMode ? 'images/settingsLightGrey.svg' : 'images/settings.svg',
      'images/copyGrey.svg',
      'images/bch-icon.svg',
      darkMode ? 'images/qrscanLightGrey.svg' : 'images/qrscan.svg',
    )
  } else {
    images.push(
      darkMode ? 'images/plus-square-lightGrey.svg' : 'images/plus-square.svg',
      darkMode ? 'images/import-lightGrey.svg' : 'images/import.svg',
    )
  }
  for (const href of images) {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = href
    document.head.appendChild(link)
  }
})
