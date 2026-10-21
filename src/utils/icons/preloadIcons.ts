// On web, static icons in public/ are only fetched the first time a component renders
// them, so icons pop in when first navigating to a view (e.g. settings and about page).
// This fetches every svg icon in public/ shortly after startup, as listed at build time in
// quasar.config.ts: about 20 KB gzipped for all of them, both themes included.
export function preloadIcons() {
  // Electron and Capacitor load icons from local files instantly, only web needs this
  if (!import.meta.env.QUASAR_SPA_MODE) return;

  // the icons index.html preloads are fetched already, and come from the browser cache here
  const iconPaths = String(import.meta.env.iconPaths).split(',');

  // wait a moment so the icon fetches don't compete with app startup
  setTimeout(() => {
    for (const path of iconPaths) {
      // setting an Image src fetches the file into the browser cache, same effect
      // as the preload links in index.html but without unused-preload browser warnings
      new Image().src = path;
    }
  }, 1000);
}
