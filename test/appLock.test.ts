import { describe, expect, it } from 'vitest'
import { isValidPin, makePinRecord, pinMatches, retryDelayMs } from '../src/utils/appLock'

describe('isValidPin', () => {
  it.each(['1234', '000000', '12345678'])('takes %s', (pin) => {
    expect(isValidPin(pin)).toBe(true)
  })
  // too short, too long, and anything that is not a digit, a full-width one included
  it.each(['', '123', '123456789', '12a4', '12 34', '１２３４', '-1234'])('refuses "%s"', (pin) => {
    expect(isValidPin(pin)).toBe(false)
  })
})

describe('the stored PIN', () => {
  it('matches the PIN it was made from and no other', async () => {
    const record = await makePinRecord('4821')
    expect(await pinMatches('4821', record)).toBe(true)
    expect(await pinMatches('4822', record)).toBe(false)
    // a PIN that only starts the same
    expect(await pinMatches('48210', record)).toBe(false)
  })

  it('holds neither the PIN nor the same hash twice for one PIN', async () => {
    const first = await makePinRecord('4821')
    const second = await makePinRecord('4821')
    expect(JSON.stringify(first)).not.toContain('4821')
    expect(first.salt).not.toBe(second.salt)
    expect(first.hash).not.toBe(second.hash)
  })

  it('refuses to store a PIN that is not one', async () => {
    await expect(makePinRecord('12')).rejects.toThrow()
  })

  // a record written with other parameters keeps verifying after the default changes
  it('verifies with the iterations the record names', async () => {
    const record = await makePinRecord('4821')
    expect(await pinMatches('4821', { ...record, iterations: record.iterations + 1 })).toBe(false)
  })
})

describe('retryDelayMs', () => {
  it('lets the first tries through without a wait', () => {
    for (let failed = 0; failed < 5; failed++) expect(retryDelayMs(failed)).toBe(0)
  })
  it('doubles the wait from half a minute up to a quarter of an hour', () => {
    expect(retryDelayMs(5)).toBe(30_000)
    expect(retryDelayMs(6)).toBe(60_000)
    expect(retryDelayMs(7)).toBe(120_000)
    expect(retryDelayMs(10)).toBe(15 * 60_000)
    expect(retryDelayMs(1000)).toBe(15 * 60_000)
  })
})
