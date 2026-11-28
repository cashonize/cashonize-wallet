// A one-off notice for Android installs from before the app opted out of Android's backup: their
// seed phrase may sit in the phone's Google backup, and not everyone reads release notes. An
// install that starts without a wallet was never backed up and is never told. Removable once
// the installs of that time have seen it.

const storageKey = 'androidBackupNotice'
const dismissed = 'dismissed'
export const androidBackupNoticeSnoozeMs = 24 * 60 * 60 * 1000

// stored: nothing yet, "dismissed", or the time until which the notice is snoozed
export function androidBackupNoticeDue(stored: string | null, walletExists: boolean, now: number): boolean {
  if (stored === dismissed) return false
  if (stored === null) return walletExists
  return now >= Number(stored)
}

// Whether to show the notice now. Showing it snoozes it, so closing the dialog any other way
// than "Got it", or the app being closed under it, brings it back later.
export function takeAndroidBackupNotice(walletExists: boolean, now: number): boolean {
  const stored = localStorage.getItem(storageKey)
  if (stored === null && !walletExists) {
    dismissAndroidBackupNotice()
    return false
  }
  if (!androidBackupNoticeDue(stored, walletExists, now)) return false
  localStorage.setItem(storageKey, String(now + androidBackupNoticeSnoozeMs))
  return true
}

export function dismissAndroidBackupNotice() {
  localStorage.setItem(storageKey, dismissed)
}
