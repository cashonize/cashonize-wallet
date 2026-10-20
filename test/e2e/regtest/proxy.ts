// A WebSocket proxy between the app and the regtest Fulcrum. Fulcrum on regtest only takes bchreg
// addresses, while the app in chipnet mode asks by its bchtest ones (the same scripts), so every
// address is rewritten on the way in and back on the way out. A control endpoint lets a test drop
// the app's connection right after a broadcast reached the server.

import { createServer, type Server } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { FULCRUM_WS_PORT, FUNDER_PROXY_PORT, PROXY_CONTROL_PORT, PROXY_PORT, PROXY_TLS_PORT, toChipnet, toRegtest } from './chain'

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

// What one proxy instance saw: the app's connections open to it now, and every address the app
// asked it about (blockchain.address.*), in the app's bchtest form
export interface InstanceStats {
  connections: number
  addresses: string[]
}

interface Instance {
  server: WebSocketServer
  stats: { addresses: Set<string> }
}

// Proxy instance A takes plain ws://, as the app's stored setting can name it; B serves wss:// on a
// self-signed certificate, as the settings form only makes wss:// URLs, so a test can switch the
// app from A to B the way a user switches servers
export function startProxy(tls: { key: string, cert: string }): Proxy {
  let dropNextBroadcast = false

  // `droppable`: whether a dropped broadcast can hit it, which is for the app's connections only
  const instance = (server: WebSocketServer, droppable = true): Instance => {
    const stats = { addresses: new Set<string>() }
    server.on('connection', client => {
      const upstream = new WebSocket(`ws://127.0.0.1:${FULCRUM_WS_PORT}`)
      const pending: string[] = []
      upstream.on('open', () => {
        for (const frame of pending.splice(0)) upstream.send(frame)
      })
      client.on('message', data => {
        const original = text(data)
        recordAddresses(original, stats.addresses)
        const frame = rewriteFrame(original, 'bchtest')
        const isBroadcast = frame.includes('"blockchain.transaction.broadcast"')
        if (upstream.readyState === WebSocket.OPEN) upstream.send(frame)
        else pending.push(frame)
        if (isBroadcast && droppable && dropNextBroadcast) {
          dropNextBroadcast = false
          // the broadcast is on its way to the server, the app never hears its answer
          client.terminate()
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
    return { server, stats }
  }

  const a = instance(new WebSocketServer({ host: '127.0.0.1', port: PROXY_PORT }))
  const httpsServer = createHttpsServer(tls).listen(PROXY_TLS_PORT, '127.0.0.1')
  const b = instance(new WebSocketServer({ server: httpsServer }))
  const instances = { a, b }
  // the test process's funder wallet, kept apart so that its connection and addresses never count
  // as the app's
  const funder = instance(new WebSocketServer({ host: '127.0.0.1', port: FUNDER_PROXY_PORT }), false)

  const control: Server = createServer((request, response) => {
    if (request.url === '/drop-next-broadcast') dropNextBroadcast = true
    if (request.url === '/reset') {
      dropNextBroadcast = false
      for (const { stats } of Object.values(instances)) stats.addresses.clear()
    }
    if (request.url === '/stats') {
      const stats = Object.fromEntries(Object.entries(instances).map(([name, { server, stats }]) => [name, {
        connections: [...server.clients].filter(client => client.readyState === WebSocket.OPEN).length,
        addresses: [...stats.addresses],
      } satisfies InstanceStats]))
      response.end(JSON.stringify(stats))
      return
    }
    response.end('ok')
  }).listen(PROXY_CONTROL_PORT, '127.0.0.1')

  return {
    close: async () => {
      for (const { server } of [a, b, funder]) {
        for (const client of server.clients) client.terminate()
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
      httpsServer.close()
      control.close()
    },
  }
}

function recordAddresses(frame: string, addresses: Set<string>) {
  for (const line of frame.split('\n')) {
    if (!line.trim()) continue
    try {
      const messages = [JSON.parse(line) as unknown].flat() as { method?: string, params?: unknown[] }[]
      for (const { method, params } of messages) {
        if (!method?.startsWith('blockchain.address.')) continue
        const address = params?.[0]
        if (typeof address === 'string') addresses.add(address)
      }
    } catch {
      // not JSON: nothing to record
    }
  }
}

// For the tests, which run in other processes than the proxy
export async function dropNextBroadcast(): Promise<void> {
  await fetch(`http://127.0.0.1:${PROXY_CONTROL_PORT}/drop-next-broadcast`)
}

export async function proxyStats(): Promise<{ a: InstanceStats, b: InstanceStats }> {
  const response = await fetch(`http://127.0.0.1:${PROXY_CONTROL_PORT}/stats`)
  return await response.json() as { a: InstanceStats, b: InstanceStats }
}
