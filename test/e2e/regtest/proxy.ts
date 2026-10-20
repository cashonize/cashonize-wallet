// A WebSocket proxy between the app and the regtest Fulcrum. Fulcrum on regtest only takes bchreg
// addresses, while the app in chipnet mode asks by its bchtest ones (the same scripts), so every
// address is rewritten on the way in and back on the way out. A control endpoint lets a test drop
// the app's connection right after a broadcast reached the server.

import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { FULCRUM_WS_PORT, PROXY_CONTROL_PORT, PROXY_PORT, toChipnet, toRegtest } from './chain'

const CASHADDR = /^(bchtest|bchreg):[qpzr][02-9ac-hj-np-z]+$/

function rewrite(value: unknown, from: 'bchtest' | 'bchreg'): unknown {
  if (typeof value === 'string') {
    if (!CASHADDR.test(value) || !value.startsWith(`${from}:`)) return value
    return from === 'bchtest' ? toRegtest(value) : toChipnet(value)
  }
  if (Array.isArray(value)) return value.map(item => rewrite(item, from))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, from)]))
  }
  return value
}

function text(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString()
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString()
  return data.toString()
}

// electrum-cash sends one JSON message per frame, possibly newline-terminated. A frame that is not
// JSON passes unchanged: a throw here would end the proxy, which runs in the test runner's process.
function rewriteFrame(frame: string, from: 'bchtest' | 'bchreg'): string {
  return frame.split('\n').map(line => {
    if (!line.trim()) return line
    try {
      return JSON.stringify(rewrite(JSON.parse(line), from))
    } catch {
      return line
    }
  }).join('\n')
}

export interface Proxy {
  close(): Promise<void>
}

export function startProxy(): Proxy {
  let dropNextBroadcast = false
  const wss = new WebSocketServer({ host: '127.0.0.1', port: PROXY_PORT })
  wss.on('connection', client => {
    const upstream = new WebSocket(`ws://127.0.0.1:${FULCRUM_WS_PORT}`)
    const pending: string[] = []
    upstream.on('open', () => {
      for (const frame of pending.splice(0)) upstream.send(frame)
    })
    client.on('message', data => {
      const frame = rewriteFrame(text(data), 'bchtest')
      const isBroadcast = frame.includes('"blockchain.transaction.broadcast"')
      if (upstream.readyState === WebSocket.OPEN) upstream.send(frame)
      else pending.push(frame)
      if (isBroadcast && dropNextBroadcast) {
        dropNextBroadcast = false
        // the server has the broadcast; the app never hears back
        setTimeout(() => client.terminate(), 50)
      }
    })
    upstream.on('message', data => {
      if (client.readyState === WebSocket.OPEN) client.send(rewriteFrame(text(data), 'bchreg'))
    })
    client.on('close', () => upstream.close())
    upstream.on('close', () => client.close())
    client.on('error', () => upstream.close())
    upstream.on('error', () => client.close())
  })

  const control: Server = createServer((request, response) => {
    if (request.url === '/drop-next-broadcast') dropNextBroadcast = true
    if (request.url === '/reset') dropNextBroadcast = false
    response.end('ok')
  }).listen(PROXY_CONTROL_PORT, '127.0.0.1')

  return {
    close: () => new Promise(resolve => {
      for (const client of wss.clients) client.terminate()
      control.close()
      wss.close(() => resolve())
    }),
  }
}

// For the tests, which run in other processes than the proxy
export async function dropNextBroadcast(): Promise<void> {
  await fetch(`http://127.0.0.1:${PROXY_CONTROL_PORT}/drop-next-broadcast`)
}
