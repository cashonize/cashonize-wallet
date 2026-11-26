// When the wallet page asks for a backup: the wallet holds coins and its seed phrase was never
// backed up. "Remind me later" hides the notice for a while, never for good; only a development
// wallet's reminder can be turned off, from the backup page.

import type { BackupStatus } from "src/stores/settingsStore"

export const backupReminderSnoozeMs = 7 * 24 * 60 * 60 * 1000

export function backupReminderDue(status: BackupStatus, holdsCoins: boolean, snoozedUntil: number | undefined, now: number): boolean {
  if (status !== 'none' || !holdsCoins) return false
  return now >= (snoozedUntil ?? 0)
}
