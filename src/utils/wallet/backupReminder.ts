// When the wallet page asks for a backup: the wallet holds coins and its seed phrase was never
// backed up. "Remind me later" hides the notice for a while, never for good. A development wallet
// is never asked: it holds no real funds.

import type { BackupStatus } from "src/stores/settingsStore"
import type { AppNetwork } from "src/utils/wallet/networks"
import type { WalletInfo } from "src/utils/wallet/dbUtils"

export const backupReminderSnoozeMs = 7 * 24 * 60 * 60 * 1000

// A wallet that lives on a test network only. Not an older wallet's chipnet copy: it has the keys
// of the mainnet wallet.
export function isDevelopmentWallet(network: AppNetwork, walletInfo: WalletInfo | undefined): boolean {
  return network !== 'mainnet' && walletInfo !== undefined && !walletInfo.networks.includes('mainnet')
}

export interface BackupReminderState {
  status: BackupStatus
  holdsCoins: boolean
  developmentWallet: boolean
  snoozedUntil: number | undefined
  now: number
}

export function backupReminderDue({ status, holdsCoins, developmentWallet, snoozedUntil, now }: BackupReminderState): boolean {
  if (status !== 'none' || !holdsCoins || developmentWallet) return false
  return now >= (snoozedUntil ?? 0)
}
