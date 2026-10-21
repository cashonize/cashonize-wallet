import { describe, expect, it } from 'vitest'

import { mapConcurrent } from '../src/utils/concurrency'

describe('mapConcurrent', () => {
  it('keeps at most the limit in flight, and keeps the order of the items', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const results = await mapConcurrent([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, item % 3))
      inFlight--
      return item * 10
    })
    expect(maxInFlight).toBe(3)
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70])
  })

  // the next call starts when one settles, not when a whole batch has
  it('starts the next item while a slow one is still running', async () => {
    let releaseSlow!: () => void
    const slow = new Promise<void>(resolve => { releaseSlow = resolve })
    const started: number[] = []
    const run = mapConcurrent([0, 1, 2, 3], 2, async (item) => {
      started.push(item)
      if (item === 0) await slow
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(started).toEqual([0, 1, 2, 3])
    releaseSlow()
    await run
  })

  it('rejects when a call rejects, as Promise.all does', async () => {
    const run = mapConcurrent([1, 2, 3], 2, (item) =>
      item === 2 ? Promise.reject(new Error('lookup failed')) : Promise.resolve(item))
    await expect(run).rejects.toThrow('lookup failed')
  })
})
