// What a site can reach through the extension: only the accounts it was given, for the wallet
// they belong to, and nothing of the wallet's storage or of the ports the wallet page uses.

import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { SignedMessage } from '@cashonize/bch-wallet-lib'
import { addChipnetWallet, setupWalletOnChipnet, waitForDialog } from '../helpers'
import { launchExtension, stopExtensionServiceWorker } from './extension'

// Two sites the content script serves: the test dApp under two origins
const SITE_A = 'http://localhost:5188'
const SITE_B = 'http://127.0.0.1:5188'

let context: BrowserContext
let closeExtension: (() => Promise<void>) | undefined
let walletPage: Page
let siteA: Page
let siteB: Page
let accountsA: string[] = []
let accountsB: string[] = []

async function openSite(url: string) {
  const page = await context.newPage()
  await page.goto(url)
  await expect(page.locator('#bex-provider-status')).toHaveText('available', { timeout: 15_000 })
  await page.evaluate(() => {
    window.accountEvents = []
    window.cashonize.on('accountsChanged', accounts => window.accountEvents!.push(accounts as string[]))
  })
  return page
}

const accountEvents = (site: Page) => site.evaluate(() => window.accountEvents ?? [])

// Connects a site to the receive address at an index of the HD wallet
async function connect(site: Page, index: number): Promise<string[]> {
  const pending = site.evaluate(() => window.cashonize.request({
    method: 'bch_requestAccounts',
    params: { dappMetadata: { name: 'Isolation probe' } },
  }))
  const dialog = await waitForDialog(walletPage)
  if (index > 0) {
    // a new wallet's addresses beyond the first are empty, which the picker hides by default
    await dialog.locator('.options-toggle').click()
    await dialog.locator('.q-toggle').click()
  }
  const badge = walletPage.locator('.index-badge', { hasText: new RegExp(`^${index}$`) })
  await dialog.locator('.address-item', { has: badge }).click()
  await dialog.getByRole('button', { name: 'Approve' }).click()
  return await pending as string[]
}

// Runs code in the extension's content-script world of a page: what a compromised renderer of
// that page can do as well
async function inContentScriptWorld(page: Page, expression: string): Promise<unknown> {
  const cdp = await context.newCDPSession(page)
  try {
    const contexts: Array<{ id: number; origin: string; auxData?: { type?: string } }> = []
    cdp.on('Runtime.executionContextCreated', event => contexts.push(event.context))
    await cdp.send('Runtime.enable')
    const world = contexts.find(candidate =>
      candidate.origin.startsWith('chrome-extension://') && candidate.auxData?.type === 'isolated')
    if (!world) throw new Error('content script world not found')
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression,
      contextId: world.id,
      awaitPromise: true,
      returnByValue: true,
    })
    return evaluated.result.value
  } finally {
    await cdp.detach()
  }
}

test.describe.serial('Cashonize BEX — what a site can reach', () => {
  test.beforeAll(async () => {
    const launched = await launchExtension()
    context = launched.context
    closeExtension = launched.close
    walletPage = await context.newPage()
    await setupWalletOnChipnet(walletPage, 'hd', launched.extensionUrl)
    siteA = await openSite(SITE_A)
    siteB = await openSite(SITE_B)
  })

  test.afterAll(async () => {
    await closeExtension?.()
  })

  // first, while no site is connected: a connected site's bch_requestAccounts queues no prompt
  test('answers an unconnected site itself, and lets it queue one connect', async () => {
    const signing = await siteB.evaluate(() =>
      window.cashonize.send({ jsonrpc: '2.0', id: 1, method: 'bch_signMessage', params: { message: 'unconnected' } }))
    expect(signing.error?.code).toBe(4100)
    await expect(walletPage.locator('.q-dialog:visible')).toHaveCount(0)

    const outcome = await siteB.evaluate(async () => {
      const send = (id: number, method: string) => window.cashonize.send({ jsonrpc: '2.0', id, method, params: {} })
      const connect = send(2, 'bch_requestAccounts')
      const secondConnect = await send(3, 'bch_connect')
      await window.cashonize.request({ method: 'bch_cancelPendingRequests', params: {} })
      return { secondConnect: secondConnect.error?.code, cancelled: (await connect).error?.code }
    })
    expect(outcome).toEqual({ secondConnect: -32002, cancelled: 5000 })
    await expect(walletPage.locator('.q-dialog:visible')).toHaveCount(0)
  })

  test('shows each site only the accounts it was given', async () => {
    accountsB = await connect(siteB, 3)
    accountsA = await connect(siteA, 0)
    expect(accountsA).not.toEqual(accountsB)

    await siteB.waitForTimeout(1000)
    expect(await accountEvents(siteB)).toEqual([accountsB])
    expect(await accountEvents(siteA)).toEqual([accountsA])
  })

  test('tells the sites nothing when the wallet page loads again', async () => {
    await walletPage.reload()
    await walletPage.locator('.depositAddr').first().waitFor({ timeout: 30_000 })
    await siteB.waitForTimeout(2000)
    expect(await accountEvents(siteB)).toEqual([accountsB])
    expect(await accountEvents(siteA)).toEqual([accountsA])
  })

  test('answers a request sent while the worker restarts, and the restart is no change', async () => {
    await stopExtensionServiceWorker(context)
    const answer = await siteA.evaluate(() => Promise.race([
      window.cashonize.request({ method: 'bch_getAddresses', params: {} }),
      new Promise(resolve => setTimeout(() => resolve('no answer within 10 s'), 10_000)),
    ]))
    expect(answer).toEqual(accountsA)

    await siteA.waitForTimeout(1500)
    expect(await accountEvents(siteA)).toEqual([accountsA])
  })

  test('keeps the extension storage and the wallet page port from web pages', async () => {
    const read = await inContentScriptWorld(siteB, `(async () => {
      try {
        await chrome.storage.local.get(null)
        return 'read'
      } catch (error) {
        return 'refused'
      }
    })()`)
    expect(read).toBe('refused')

    // the wallet page's port, and the Quasar bridge port its boot waits on
    for (const name of ['cashonize-app', 'app']) {
      const appPort = await inContentScriptWorld(siteB, `new Promise(resolve => {
        const port = chrome.runtime.connect({ name: '${name}' })
        port.onMessage.addListener(() => resolve('answered'))
        port.onDisconnect.addListener(() => resolve('disconnected'))
        try {
          port.postMessage({ type: 'event', event: 'accountsChanged', data: ['bchtest:qforged'] })
        } catch {
          resolve('disconnected')
        }
        setTimeout(() => resolve('connected'), 2000)
      })`)
      expect(appPort, name).toBe('disconnected')
    }
    expect(await siteA.evaluate(() => window.cashonize.selectedAddress)).toBe(accountsA[0])
  })

  test('limits what one connected site can queue', async () => {
    const outcome = await siteB.evaluate(async () => {
      const send = (id: number) =>
        window.cashonize.send({ jsonrpc: '2.0', id, method: 'bch_signMessage', params: { message: 'queue limit' } })
      const messages = [11, 12, 13, 14, 15, 16].map(send)
      const overLimit = await messages[5]!
      await window.cashonize.request({ method: 'bch_cancelPendingRequests', params: {} })
      const cancelled = await Promise.all(messages.slice(0, 5))
      return { overLimit: overLimit.error?.code, cancelled: cancelled.map(response => response.error?.code) }
    })
    expect(outcome).toEqual({ overLimit: -32005, cancelled: [5000, 5000, 5000, 5000, 5000] })
    await expect(walletPage.locator('.q-dialog:visible')).toHaveCount(0)
  })

  test('hides a site\'s accounts while another wallet is open', async () => {
    await addChipnetWallet(walletPage, { walletType: 'hd' })

    await expect.poll(() => siteB.evaluate(() => window.cashonize.selectedAddress), { timeout: 15_000 }).toBeUndefined()
    expect((await accountEvents(siteB)).at(-1)).toEqual([])
    expect(await siteB.evaluate(() => window.cashonize.request({ method: 'bch_getAddresses', params: {} }))).toEqual([])
    const refused = await siteB.evaluate(() => window.cashonize.send({
      jsonrpc: '2.0',
      id: 9,
      method: 'bch_signMessage',
      params: { message: 'another wallet' },
    }))
    expect(refused.error?.code).toBe(4100)
  })

  // An update reloads the extension, as chrome.runtime.reload() does here, and an open tab keeps
  // the old content script until the page loads again
  test('answers an open tab after the extension updates, and reconnects it on a reload', async () => {
    // a site with accounts in the wallet open now
    accountsA = await connect(siteA, 0)
    expect((await accountEvents(siteA)).at(-1)).toEqual(accountsA)

    const worker = context.serviceWorkers().find(candidate => candidate.url().endsWith('/background.js'))!
    const updated = context.waitForEvent('serviceworker')
    await worker.evaluate(() => (globalThis as unknown as { chrome: { runtime: { reload(): void } } }).chrome.runtime.reload())
      .catch(() => { /* the worker goes away with the reload */ })
    await updated

    const orphaned = await siteA.evaluate(() => Promise.race([
      window.cashonize.send({ jsonrpc: '2.0', id: 21, method: 'bch_getNetwork', params: {} }),
      new Promise(resolve => setTimeout(() => resolve('no answer within 10 s'), 10_000)),
    ])) as { error?: { code: number; message: string } }
    expect(orphaned.error?.code).toBe(4900)
    expect(orphaned.error?.message).toMatch(/reload/)
    await expect.poll(async () => (await accountEvents(siteA)).at(-1)).toEqual([])

    // the permission outlives the update: the reloaded page has its accounts without a prompt
    await siteA.reload()
    await expect(siteA.locator('#bex-provider-status')).toHaveText('available', { timeout: 15_000 })
    expect(await siteA.evaluate(() => window.cashonize.request({ method: 'bch_getAddresses', params: {} }))).toEqual(accountsA)

    // and its requests reach the wallet again, in the approval window the worker opens
    const opening = context.waitForEvent('page')
    const signing = siteA.evaluate(() => window.cashonize.signMessage({ message: 'after the update' }))
    const dialog = await waitForDialog(await opening, 30_000)
    await dialog.getByRole('button', { name: 'Sign' }).click()
    expect(SignedMessage.verify('after the update', await signing as string, accountsA[0]!).valid).toBe(true)
  })
})
