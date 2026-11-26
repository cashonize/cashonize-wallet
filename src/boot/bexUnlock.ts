import { defineBoot } from '#q-app'

// Before the app mounts, an extension page takes over the unlock another of its pages holds, so it
// opens without the lock screen while the extension is unlocked (utils/bex/sharedUnlock.ts)
export default defineBoot(async () => {
  if (!import.meta.env.QUASAR_BEX_MODE) return
  const { shareUnlockAcrossPages } = await import('src/utils/bex/sharedUnlock')
  await shareUnlockAcrossPages()
})
