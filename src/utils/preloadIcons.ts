// On web, static icons in public/ are only fetched the first time a component renders
// them, so icons pop in when first navigating to a view (e.g. settings and about page).
export function preloadIcons(darkMode: boolean) {
  // Electron and Capacitor load icons from local files instantly, only web needs this
  if (!import.meta.env.QUASAR_SPA_MODE) return;

  // Main icons displayed on initial pages, excluding icons preloaded in index.html
  const iconPaths = [
    // settings menu and about page
    'emoji-icons/greenhearth.svg',
    'images/settingsGreen.svg',
    darkMode ? 'images/external-link-grey.svg' : 'images/external-link.svg',
    // token cards on the tokens tab
    darkMode ? 'images/sendLightGrey.svg' : 'images/send.svg',
    darkMode ? 'images/infoLightGrey.svg' : 'images/info.svg',
    darkMode ? 'images/star-empty-grey.svg' : 'images/star-empty.svg',
    'images/star-full.svg',
    darkMode ? 'images/chevron-square-down-lightGrey.svg' : 'images/chevron-square-down.svg',
    darkMode ? 'images/chevron-square-up-lightGrey.svg' : 'images/chevron-square-up.svg',
    // dapp session lists on the connect tab
    darkMode ? 'images/trashLightGrey.svg' : 'images/trash.svg',
  ];

  // wait a moment so the icon fetches don't compete with app startup
  setTimeout(() => {
    for (const path of iconPaths) {
      // setting an Image src fetches the file into the browser cache, same effect
      // as the preload links in index.html but without unused-preload browser warnings
      new Image().src = path;
    }
  }, 1000);
}
