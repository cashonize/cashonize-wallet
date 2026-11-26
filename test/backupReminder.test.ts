import { describe, it, expect } from 'vitest'
import { backupReminderDue, backupReminderSnoozeMs } from '../src/utils/wallet/backupReminder'

describe('backupReminderDue', () => {
  const now = 1_800_000_000_000

  it('asks only a wallet that holds coins and was never backed up', () => {
    expect(backupReminderDue('none', true, undefined, now)).toBe(true)
    expect(backupReminderDue('none', false, undefined, now)).toBe(false)
    expect(backupReminderDue('verified', true, undefined, now)).toBe(false)
    expect(backupReminderDue('imported', true, undefined, now)).toBe(false)
    expect(backupReminderDue('dismissed', true, undefined, now)).toBe(false)
  })

  it('stays hidden for the snooze and comes back after it', () => {
    const snoozedUntil = now + backupReminderSnoozeMs
    expect(backupReminderDue('none', true, snoozedUntil, now)).toBe(false)
    expect(backupReminderDue('none', true, snoozedUntil, snoozedUntil - 1)).toBe(false)
    expect(backupReminderDue('none', true, snoozedUntil, snoozedUntil)).toBe(true)
  })
})
