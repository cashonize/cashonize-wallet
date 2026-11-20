// The interactive requests waiting for the wallet page, which the service worker persists so a
// wallet-page reload or a worker restart resumes the same sequence.

import type { Wc2Error, Wc2Request } from 'src/interfaces/bex'
import { isWebOrigin } from './permissions'

export const BEX_QUEUE_KEY = 'bexPendingRequests'

// What a site can hold the wallet's attention with: a few prompts in line and one connect at a
// time, while the queue as a whole stays bounded however many sites ask. The error codes are
// EIP-1474's, which dApps already handle: -32002 resource unavailable, -32005 limit exceeded.
export const MAX_QUEUED_PER_ORIGIN = 5
// a full queue of the largest requests stays inside storage.session's 10 MB
export const MAX_QUEUED = 8
// Room for a standard-size transaction (100 kB, twice that as hex) with its source outputs and
// contract data; it bounds what the worker holds and persists for a request
export const MAX_REQUEST_BYTES = 1024 * 1024
export const CONNECT_METHODS = new Set(['bch_requestAccounts', 'bch_connect'])

export interface BexQueuedRequest {
  internalRequestId: number
  origin: string
  // The dApp tab that sent the request; used to route the answer back after a worker restart.
  tabId?: number
  message: Wc2Request
  createdAt: number
}

function isWc2Request(value: unknown): value is Wc2Request {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<Wc2Request>
  return message.jsonrpc === '2.0'
    && typeof message.id === 'number'
    && typeof message.method === 'string'
}

export function normalizeQueue(raw: unknown): BexQueuedRequest[] {
  if (!Array.isArray(raw)) return []

  const queue: BexQueuedRequest[] = []
  const seen = new Set<number>()
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const entry = value as Partial<BexQueuedRequest>
    if (typeof entry.internalRequestId !== 'number' || seen.has(entry.internalRequestId)) continue
    if (!isWebOrigin(entry.origin) || !isWc2Request(entry.message)) continue
    if (typeof entry.createdAt !== 'number') continue
    seen.add(entry.internalRequestId)
    queue.push({
      internalRequestId: entry.internalRequestId,
      origin: entry.origin,
      ...(typeof entry.tabId === 'number' ? { tabId: entry.tabId } : {}),
      message: entry.message,
      createdAt: entry.createdAt,
    })
  }
  return queue.sort((a, b) => a.internalRequestId - b.internalRequestId)
}

// Why a new request from a site is answered at once instead of joining the queue, if it is
export function admissionError(queue: readonly BexQueuedRequest[], origin: string, request: Wc2Request): Wc2Error | undefined {
  if (JSON.stringify(request).length > MAX_REQUEST_BYTES) {
    return { code: -32005, message: 'Request too large' }
  }
  const fromOrigin = queue.filter(entry => entry.origin === origin)
  if (CONNECT_METHODS.has(request.method) && fromOrigin.some(entry => CONNECT_METHODS.has(entry.message.method))) {
    return { code: -32002, message: 'A connection request from this site is already pending' }
  }
  if (fromOrigin.length >= MAX_QUEUED_PER_ORIGIN) {
    return { code: -32005, message: 'Too many pending requests from this site' }
  }
  if (queue.length >= MAX_QUEUED) {
    return { code: -32005, message: 'Too many pending requests' }
  }
  return undefined
}
