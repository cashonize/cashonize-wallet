// Shared by the extension suites: the built extension in a fresh Chromium profile, and the
// provider the test dApp sees.

import { chromium, expect, type BrowserContext } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export interface Wc2Response {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

export interface CashonizeProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>
  send(message: { jsonrpc: '2.0'; id: number; method: string; params?: unknown }): Promise<Wc2Response>
  on(event: string, listener: (data: unknown) => void): unknown
  isConnected(): boolean
  enable(): Promise<unknown>
  isBitcoinCash: boolean
  // the WC2-BCH connector interface
  address(): Promise<string | undefined>
  signTransaction(options: unknown): Promise<unknown>
  signMessage(options: unknown): Promise<unknown>
  connect(options?: { chainId?: string }): Promise<void>
  connected(): Promise<boolean>
  disconnect(): Promise<void>
  readonly chainId?: string
  readonly networkVersion?: string
  readonly selectedAddress?: string
}

declare global {
  interface Window {
    cashonize: CashonizeProvider
    bitcoincash: CashonizeProvider
    queuedResponses?: Promise<Wc2Response>[]
    accountEvents?: string[][]
  }
}

const extensionPath = resolve(import.meta.dirname, '../../../dist/bex-chrome')

// The built extension (pnpm build:bex) in a fresh profile, and the URL of its wallet page
export async function launchExtension() {
  expect(existsSync(join(extensionPath, 'manifest.json')), 'run pnpm build:bex first').toBe(true)
  const profileDir = mkdtempSync(join(tmpdir(), 'cashonize-bex-e2e-'))
  // Developer mode, as when loading an unpacked extension by hand: without it, Chromium does not
  // load the extension again after chrome.runtime.reload(), the way it does after an update
  mkdirSync(join(profileDir, 'Default'))
  writeFileSync(join(profileDir, 'Default', 'Preferences'), JSON.stringify({ extensions: { ui: { developer_mode: true } } }))
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })

  let worker = context.serviceWorkers()[0]
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 })
  const extensionUrl = `chrome-extension://${new URL(worker.url()).host}/www/index.html`
  const close = async () => {
    await context.close()
    rmSync(profileDir, { recursive: true, force: true })
  }
  return { context, extensionUrl, close }
}

// Stops the extension service worker through CDP; Chrome starts it again on the next port
// connection, the way it does after the MV3 idle timeout.
export async function stopExtensionServiceWorker(context: BrowserContext) {
  const browser = context.browser()
  if (!browser) throw new Error('Browser is not available')
  const cdp = await browser.newBrowserCDPSession()
  try {
    const { targetInfos } = await cdp.send('Target.getTargets')
    const target = targetInfos.find(info =>
      info.type === 'service_worker' && info.url.endsWith('/background.js'))
    if (!target) throw new Error('extension service worker target not found')
    await cdp.send('Target.closeTarget', { targetId: target.targetId })
  } finally {
    await cdp.detach()
  }
}
