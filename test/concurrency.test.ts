import { describe, expect, it, vi } from 'vitest'

import { mapConcurrent, sharedRun } from '../src/utils/concurrency'

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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

describe('sharedRun', () => {
  it('shares a run between callers and calls fn again for each caller asking during the run', async () => {
    const calls: ReturnType<typeof deferred<number>>[] = []
    const shared = sharedRun(() => {
      const call = deferred<number>()
      calls.push(call)
      return call.promise
    })

    const first = shared.run()
    const joined = shared.run()
    const again = shared.run({ again: true })
    expect(calls).toHaveLength(1)

    calls[0]!.resolve(1)
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    // asked during the repeat, so it repeats once more
    const later = shared.run({ again: true })
    calls[1]!.resolve(2)
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    calls[2]!.resolve(3)

    expect(await Promise.all([first, joined, again, later])).toEqual([3, 3, 3, 3])
    // the run ended, so the next caller starts a new one
    void shared.run()
    expect(calls).toHaveLength(4)
  })

  it('does not call fn again for callers that only join', async () => {
    let calls = 0
    const shared = sharedRun(() => Promise.resolve(++calls))
    const results = await Promise.all([shared.run(), shared.run(), shared.run()])
    expect(results).toEqual([1, 1, 1])
  })

  // as when the next wallet opens while the previous one's run is in flight
  it('starts a run of its own for a new key, which the old run neither repeats nor detaches', async () => {
    let key = 1
    const calls: { key: number, call: ReturnType<typeof deferred<number>> }[] = []
    const shared = sharedRun(() => {
      const call = deferred<number>()
      calls.push({ key, call })
      return call.promise
    }, () => key)

    const old = shared.run()
    void shared.run({ again: true })
    key = 2
    const fresh = shared.run()
    expect(calls.map(c => c.key)).toEqual([1, 2])

    calls[0]!.call.resolve(10)
    expect(await old).toBe(10)
    // the old run's end left the new one shared, and did not repeat for the old key
    expect(shared.run()).toBe(fresh)
    expect(calls).toHaveLength(2)
    calls[1]!.call.resolve(20)
    expect(await fresh).toBe(20)
  })
})
