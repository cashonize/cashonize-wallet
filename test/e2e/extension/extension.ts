// Shared by the extension suites: the built extension in a fresh Chromium profile, and the
// provider the test dApp sees.

import { chromium, expect, type BrowserContext, type Page } from '@playwright/test'
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
  cancelPendingRequests(): Promise<{ cancelledCount: number }>
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

// The toolbar popup, which the worker opens as a click on the icon does, is no tab, so Playwright
// makes no page of it: it is the extension page Playwright did not attach to, and it is driven
// over DevTools messages through the browser's session
export interface ToolbarPopup {
  evaluate<T>(expression: string): Promise<T>
  // the text of each dialog on screen
  dialogs(): Promise<string[]>
  // waits for a dialog showing `text`, then clicks its `button`
  clickInDialog(text: string, button: string, timeoutMs?: number): Promise<void>
  isOpen(): Promise<boolean>
  // uncaught errors in the popup since it was found
  errors: string[]
}

async function findToolbarPopup(context: BrowserContext) {
  const cdp = await context.browser()!.newBrowserCDPSession()
  const { targetInfos } = await cdp.send('Target.getTargets')
  await cdp.detach()
  return targetInfos.find(info => info.type === 'page' && !info.attached && info.url.startsWith('chrome-extension://'))
}

export async function toolbarPopupOpen(context: BrowserContext) {
  return (await findToolbarPopup(context)) !== undefined
}

export async function waitForToolbarPopup(context: BrowserContext, timeoutMs = 30_000): Promise<ToolbarPopup> {
  let target = await findToolbarPopup(context)
  for (const deadline = Date.now() + timeoutMs; !target; target = await findToolbarPopup(context)) {
    if (Date.now() > deadline) throw new Error('No toolbar popup opened')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const targetId = target.targetId
  const cdp = await context.browser()!.newBrowserCDPSession()
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false })

  const errors: string[] = []
  const replies = new Map<number, (reply: { result?: unknown; error?: unknown }) => void>()
  cdp.on('Target.receivedMessageFromTarget', (event) => {
    if (event.sessionId !== sessionId) return
    const message = JSON.parse(event.message) as {
      id?: number; method?: string; result?: unknown; error?: unknown
      params?: { exceptionDetails?: { exception?: { description?: string }; text?: string } }
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params?.exceptionDetails
      errors.push(details?.exception?.description ?? details?.text ?? 'error')
    }
    if (message.id !== undefined) replies.get(message.id)?.(message)
  })
  let nextId = 1
  function send(method: string, params: object) {
    const id = nextId++
    return new Promise<unknown>((resolve, reject) => {
      replies.set(id, (reply) => {
        replies.delete(id)
        if (reply.error) reject(new Error(JSON.stringify(reply.error)))
        else resolve(reply.result)
      })
      cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject)
    })
  }
  await send('Runtime.enable', {})

  async function evaluate<T>(expression: string): Promise<T> {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }) as {
      result: { value?: unknown }; exceptionDetails?: { text?: string }
    }
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text ?? 'evaluation failed')
    return reply.result.value as T
  }

  async function clickInDialog(text: string, button: string, timeoutMs = 30_000) {
    const click = `(() => {
      const dialog = [...document.querySelectorAll('.q-dialog')].reverse().find(d => d.innerText.includes(${JSON.stringify(text)}))
      const target = dialog && [...dialog.querySelectorAll('button, input[type=button], input[type=submit]')]
        .find(b => (b.value || b.innerText).trim() === ${JSON.stringify(button)})
      target?.click()
      return Boolean(target)
    })()`
    for (const deadline = Date.now() + timeoutMs; !await evaluate<boolean>(click);) {
      if (Date.now() > deadline) throw new Error(`No dialog with "${text}" and a ${button} button in the toolbar popup`)
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  function dialogs() {
    return evaluate<string[]>(`[...document.querySelectorAll('.q-dialog')]
      .filter(d => d.getClientRects().length).map(d => d.innerText)`)
  }

  async function isOpen() {
    const browser = await context.browser()!.newBrowserCDPSession()
    const { targetInfos } = await browser.send('Target.getTargets')
    await browser.detach()
    return targetInfos.some(info => info.targetId === targetId)
  }

  return { evaluate, dialogs, clickInDialog, isOpen, errors }
}

// The wallet's address, from the receive page; leaves the wallet page open again
export async function receiveAddress(page: Page, prefix: RegExp): Promise<string> {
  await page.getByRole('button', { name: 'Receive', exact: true }).click()
  await expect(page.locator('.depositAddr')).toHaveText(prefix, { timeout: 30_000 })
  const address = (await page.locator('.depositAddr').innerText()).trim()
  await page.getByRole('button', { name: 'Back' }).click()
  return address
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
