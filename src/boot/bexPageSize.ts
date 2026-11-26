import { defineBoot } from '#q-app'

// Every extension page starts sized as the toolbar popup (index.html), the one page that takes the
// size of its content; a tab or the approval window drops that size here, while it is still blank.
export default defineBoot(() => {
  if (!import.meta.env.QUASAR_BEX_MODE) return
  let toolbarPopup = false
  try {
    toolbarPopup = chrome.extension.getViews({ type: 'popup' }).includes(window)
  } catch {
    // unknown: a tab cramped to the popup's size would be worse than a popup that resizes
  }
  if (!toolbarPopup) document.documentElement.classList.remove('toolbar-popup')
})
