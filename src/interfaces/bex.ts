// The extension transport carries WalletConnect-BCH JSON-RPC messages without the WalletConnect
// relay: the method names and parameter/result shapes are the WC2-BCH ones, the transport is a
// content-script port to the extension page.
//
// Request:  { jsonrpc: '2.0', id, method, params? }
// Response: { jsonrpc: '2.0', id, result } or { jsonrpc: '2.0', id, error: { code, message } }

export interface Wc2Request {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

export interface Wc2Error {
  code: number
  message: string
  data?: unknown
}

export interface Wc2Response {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: Wc2Error | undefined
}

export type BexEventName = 'connect' | 'chainChanged' | 'accountsChanged' | 'disconnect'

// sent by the service worker only
export interface BexEventMessage {
  type: 'event'
  event: BexEventName
  data: unknown
}

export interface BexRequestMessage {
  type: 'request'
  internalRequestId: number
  origin: string
  message: Wc2Request
}

export interface BexResponseMessage {
  type: 'response'
  internalRequestId: number
  result?: unknown
  error?: Wc2Error | undefined
}

// Sent once the app page listens; isPopup marks the approval window, which the worker closes once
// the queue drains
export interface BexReadyMessage {
  type: 'ready'
  isPopup: boolean
}

export interface BexCloseMessage {
  type: 'close'
}

// A request the wallet page may still be handling was withdrawn, timed out or lost its page
export interface BexCancelMessage {
  type: 'cancel'
  internalRequestId: number
}

export interface BexTransportRequest {
  type: 'request'
  message: Wc2Request
}

export interface BexTransportResponse {
  type: 'response'
  message: Wc2Response
}
