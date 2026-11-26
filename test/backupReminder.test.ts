import { describe, it, expect } from 'vitest'
import { backupReminderDue, backupReminderSnoozeMs, isDevelopmentWallet, type BackupReminderState } from '../src/utils/wallet/backupReminder'

describe('backupReminderDue', () => {
  const now = 1_800_000_000_000
  const due: BackupReminderState = { status: 'none', holdsCoins: true, developmentWallet: false, snoozedUntil: undefined, now }

  it('asks only a wallet that holds coins and was never backed up', () => {
    expect(backupReminderDue(due)).toBe(true)
    expect(backupReminderDue({ ...due, holdsCoins: false })).toBe(false)
    expect(backupReminderDue({ ...due, status: 'verified' })).toBe(false)
    expect(backupReminderDue({ ...due, status: 'imported' })).toBe(false)
    expect(backupReminderDue({ ...due, status: 'dismissed' })).toBe(false)
  })

  it('never asks a development wallet', () => {
    expect(backupReminderDue({ ...due, developmentWallet: true })).toBe(false)
  })

  it('stays hidden for the snooze and comes back after it', () => {
    const snoozedUntil = now + backupReminderSnoozeMs
    expect(backupReminderDue({ ...due, snoozedUntil })).toBe(false)
    expect(backupReminderDue({ ...due, snoozedUntil, now: snoozedUntil - 1 })).toBe(false)
    expect(backupReminderDue({ ...due, snoozedUntil, now: snoozedUntil })).toBe(true)
  })
})

describe('isDevelopmentWallet', () => {
  it('is a wallet on test networks only, not the chipnet copy of a mainnet wallet', () => {
    expect(isDevelopmentWallet('chipnet', { name: 'dev', networks: ['chipnet'] })).toBe(true)
    expect(isDevelopmentWallet('chipnet', { name: 'old', networks: ['mainnet', 'chipnet'] })).toBe(false)
    expect(isDevelopmentWallet('mainnet', { name: 'main', networks: ['mainnet'] })).toBe(false)
    expect(isDevelopmentWallet('chipnet', undefined)).toBe(false)
  })
})
