import { describe, expect, it } from 'vitest'

import {
  admissionError,
  MAX_QUEUED,
  MAX_QUEUED_PER_ORIGIN,
  MAX_REQUEST_BYTES,
  normalizeQueue,
  type BexQueuedRequest,
} from '../src/utils/bex/queue'

const request = (id: number, method = 'bch_signMessage') => ({ jsonrpc: '2.0' as const, id, method, params: {} })

describe('normalizeQueue', () => {
  it('restores the persisted order and ignores malformed entries', () => {
    const queue = normalizeQueue([
      { internalRequestId: 7, origin: 'https://b.example', message: request(70), createdAt: 2000 },
      { internalRequestId: 3, origin: 'https://a.example', tabId: 12, message: request(30), createdAt: 1000 },
      { internalRequestId: 7, origin: 'https://dup.example', message: request(71), createdAt: 3000 },
      { internalRequestId: '4', origin: 'https://bad.example', message: request(40), createdAt: 1000 },
      { internalRequestId: 5, origin: 'https://bad.example', message: { jsonrpc: '2.0', method: 'x' }, createdAt: 1000 },
      { internalRequestId: 6, origin: 'null', message: request(60), createdAt: 1000 },
      null,
    ])

    expect(queue.map(entry => entry.internalRequestId)).toEqual([3, 7])
    expect(queue[0]?.tabId).toBe(12)
    expect(queue[1]?.origin).toBe('https://b.example')
  })

  it('returns an empty queue for missing or non-array storage values', () => {
    expect(normalizeQueue(undefined)).toEqual([])
    expect(normalizeQueue({ internalRequestId: 1 })).toEqual([])
  })
})

describe('admissionError', () => {
  const queued = (origin: string, count: number, method = 'bch_signMessage'): BexQueuedRequest[] =>
    Array.from({ length: count }, (_, index) => ({
      internalRequestId: index,
      origin,
      message: request(index, method),
      createdAt: 0,
    }))

  it('admits a request while its site and the queue have room', () => {
    expect(admissionError(queued('https://a.example', MAX_QUEUED_PER_ORIGIN - 1), 'https://a.example', request(1))).toBeUndefined()
  })

  it('keeps one connect request per site', () => {
    const queue = queued('https://a.example', 1, 'bch_requestAccounts')
    expect(admissionError(queue, 'https://a.example', request(2, 'bch_connect'))?.code).toBe(-32002)
    expect(admissionError(queue, 'https://b.example', request(2, 'bch_requestAccounts'))).toBeUndefined()
    expect(admissionError(queue, 'https://a.example', request(2))).toBeUndefined()
  })

  it('caps the requests of one site, and of all sites together', () => {
    expect(admissionError(queued('https://a.example', MAX_QUEUED_PER_ORIGIN), 'https://a.example', request(1))?.code).toBe(-32005)
    const others = Array.from({ length: MAX_QUEUED }, (_, index) => queued(`https://site${index}.example`, 1)).flat()
    expect(admissionError(others, 'https://a.example', request(1))?.code).toBe(-32005)
  })

  it('refuses a request too large to hold and persist', () => {
    const large = { ...request(1), params: { message: 'x'.repeat(MAX_REQUEST_BYTES) } }
    expect(admissionError([], 'https://a.example', large)?.message).toBe('Request too large')
  })
})
