// The provider as a WC2-BCH connector (IConnector in @bch-wc2/interfaces): a dApp that drives
// WalletConnect or an injected wallet through that interface works with window.cashonize as is,
// passing its libauth objects, and a site the user auto-approves signs its transactions unprompted.

import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { SignedMessage } from '@cashonize/bch-wallet-lib'
import { DAPP_URL, setupWalletOnChipnet, waitForDialog } from '../helpers'
import { txFixture } from '../test-dapp/src/fixtures'
import { launchExtension } from './extension'

let context: BrowserContext
let closeExtension: (() => Promise<void>) | undefined
let extensionUrl: string
let walletPage: Page
let dappPage: Page

type ExtensionChrome = {
  chrome: {
    tabs: {
      getCurrent(): Promise<{ id?: number } | undefined>
      query(query: { active: boolean; lastFocusedWindow: boolean }): Promise<Array<{ id?: number }>>
    }
  }
}

// Whether the wallet page's tab is the one in front, as the browser has it
async function walletInFront() {
  const worker = context.serviceWorkers().find(candidate => candidate.url().endsWith('/background.js'))!
  const front = await worker.evaluate(async () =>
    (await (globalThis as unknown as ExtensionChrome).chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id)
  const wallet = await walletPage.evaluate(async () => (await (globalThis as unknown as ExtensionChrome).chrome.tabs.getCurrent())?.id)
  return front !== undefined && front === wallet
}

// Entries in the dApp activity log, read in an extension page
function activityCount(page: Page) {
  return page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('dappActivity-'))
    .reduce((count, key) => count + (JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[]).length, 0))
}

// The fixture as a dApp holds it before any connector serializes it: Uint8Array and bigint fields
function signLibauthTransaction(page: Page) {
  return page.evaluate((fixture) => {
    const revive = (value: unknown): unknown => {
      if (typeof value === 'string') {
        const bytes = /^<Uint8Array: 0x([0-9a-f]*)>$/.exec(value)
        if (bytes) return Uint8Array.from(bytes[1]!.match(/../g) ?? [], byte => parseInt(byte, 16))
        const bigint = /^<bigint: (\d+)n>$/.exec(value)
        if (bigint) return BigInt(bigint[1]!)
        return value
      }
      if (Array.isArray(value)) return value.map(revive)
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, revive(item)]))
      }
      return value
    }
    // a prompt left open counts as no answer, so an unexpected dialog fails fast
    return Promise.race([
      window.cashonize.signTransaction(revive(fixture)),
      new Promise(resolve => setTimeout(() => resolve('no answer within 10 s'), 10_000)),
    ])
  }, txFixture)
}

// Records the connector events the dApp hears
async function listen(page: Page) {
  await page.evaluate(() => {
    window.connectorEvents = []
    for (const name of ['addressChanged', 'disconnect']) {
      window.cashonize.on(name, (data: unknown) => window.connectorEvents!.push([name, data]))
    }
  })
}

const connectorEvents = () => dappPage.evaluate(() => window.connectorEvents ?? [])

declare global {
  interface Window {
    connectorEvents?: Array<[string, unknown]>
  }
}

test.describe.serial('Cashonize BEX — a drop-in WC2-BCH connector', () => {
  test.beforeAll(async () => {
    const launched = await launchExtension()
    context = launched.context
    closeExtension = launched.close
    extensionUrl = launched.extensionUrl
    walletPage = await context.newPage()
    await setupWalletOnChipnet(walletPage, 'hd', extensionUrl)
    dappPage = await context.newPage()
    await dappPage.goto(DAPP_URL)
    await expect(dappPage.locator('#bex-provider-status')).toHaveText('available', { timeout: 15_000 })
    await listen(dappPage)
  })

  test.afterAll(async () => {
    await closeExtension?.()
  })

  test('connects, and connect() again is no prompt', async () => {
    expect(await dappPage.evaluate(() => window.cashonize.connected())).toBe(false)
    expect(await dappPage.evaluate(() => window.cashonize.address())).toBeUndefined()

    const connecting = dappPage.evaluate(() => window.cashonize.connect())
    const dialog = await waitForDialog(walletPage)
    await dialog.locator('.address-item').first().click()
    await dialog.getByRole('button', { name: 'Approve' }).click()
    await connecting

    const address = await dappPage.evaluate(() => window.cashonize.address())
    expect(address).toMatch(/^bchtest:/)
    expect(await dappPage.evaluate(() => window.cashonize.connected())).toBe(true)
    expect(await connectorEvents()).toEqual([['addressChanged', address]])

    // A connector dApp declares no metadata, so the card shows the page it is: title and favicon.
    await walletPage.locator('nav').getByText('Connect', { exact: true }).click()
    await expect(walletPage.locator('.bex-session-card .dapp-session-name')).toHaveText('Bitcoin Cash WalletConnect Test dApp')
    await expect(walletPage.locator('.bex-session-card .dapp-session-icon')).toHaveAttribute('src', 'http://localhost:5188/icon.png')

    await dappPage.evaluate(() => window.cashonize.connect())
    await expect(walletPage.locator('.q-dialog:visible')).toHaveCount(0)
  })

  test('refuses to connect a dApp that needs another network', async () => {
    const refusing = dappPage.evaluate(() => window.cashonize.send({
      jsonrpc: '2.0', id: 41, method: 'bch_requestAccounts', params: { chainId: 'bch:bitcoincash' },
    }))
    const dialog = await waitForDialog(walletPage)
    await expect(dialog).toContainText('mainnet')
    await dialog.getByRole('button', { name: 'OK' }).click()
    expect((await refusing).error?.code).toBe(4901)
  })

  test('signs a message, and a refusal resolves to undefined', async () => {
    const address = await dappPage.evaluate(() => window.cashonize.address())
    const signing = dappPage.evaluate(() => window.cashonize.signMessage({ message: 'connector', userPrompt: 'Sign in' }))
    let dialog = await waitForDialog(walletPage)
    await expect(dialog).toContainText('connector')
    await dialog.getByRole('button', { name: 'Sign' }).click()
    const signature = await signing as string
    expect(SignedMessage.verify('connector', signature, address!).valid).toBe(true)

    const refused = dappPage.evaluate(() => window.cashonize.signMessage({ message: 'refused' }))
    dialog = await waitForDialog(walletPage)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await refused).toBeUndefined()
  })

  test('signs a personal_sign request as bch_signMessage, as on WalletConnect', async () => {
    const address = await dappPage.evaluate(() => window.cashonize.address())
    const signing = dappPage.evaluate(() => window.cashonize.request({ method: 'personal_sign', params: { message: 'personal' } }))
    const dialog = await waitForDialog(walletPage)
    await expect(dialog).toContainText('personal')
    await dialog.getByRole('button', { name: 'Sign' }).click()
    expect(SignedMessage.verify('personal', await signing as string, address!).valid).toBe(true)
  })

  test('brings the wallet page to the front for a request', async () => {
    await dappPage.bringToFront()
    await expect.poll(walletInFront).toBe(false)
    const signing = dappPage.evaluate(() => window.cashonize.signMessage({ message: 'in front' }))
    const dialog = await waitForDialog(walletPage)
    await expect.poll(walletInFront).toBe(true)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await signing).toBeUndefined()
  })

  test('signs a transaction passed as libauth objects', async () => {
    const signing = signLibauthTransaction(dappPage)
    const dialog = await waitForDialog(walletPage)
    await expect(dialog).toContainText('Test transaction')
    await dialog.getByRole('button', { name: 'Sign' }).click()
    const signed = await signing as { signedTransaction: string; signedTransactionHash: string }
    expect(signed.signedTransaction).toMatch(/^[0-9a-f]+$/)
    expect(signed.signedTransactionHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('auto-approves the transactions of a site the user allows, and nothing else', async () => {
    await walletPage.locator('nav').getByText('Connect', { exact: true }).click()
    await walletPage.locator('.bex-session-card .dapp-session-settings').click()
    const settings = await waitForDialog(walletPage)
    await settings.locator('.q-toggle').click()
    await expect(settings.locator('input[type="radio"][value="forever"]')).toBeChecked()
    await walletPage.keyboard.press('Escape')
    await expect(walletPage.locator('.q-dialog:visible')).toHaveCount(0)

    const signed = await signLibauthTransaction(dappPage) as { signedTransactionHash?: string }
    expect(signed.signedTransactionHash).toMatch(/^[0-9a-f]{64}$/)
    await expect(walletPage.locator('.q-dialog:visible')).toHaveCount(0)

    // a message is never auto-approved
    const message = dappPage.evaluate(() => window.cashonize.signMessage({ message: 'still asked' }))
    const dialog = await waitForDialog(walletPage)
    await expect(dialog).toContainText('still asked')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await message).toBeUndefined()
  })

  // A fresh approval window is still loading the wallet when the dApp withdraws; a second request
  // keeps the window open, where a handler that missed the cancel would go on to sign
  test('signs no request the dApp withdrew, auto-approved ones included', async () => {
    const before = await activityCount(walletPage)
    await walletPage.close()
    const opening = context.waitForEvent('page', { timeout: 30_000 })
    const outcome = await dappPage.evaluate(async (fixture) => {
      const signing = window.cashonize.send({ jsonrpc: '2.0', id: 51, method: 'bch_signTransaction', params: fixture })
      await new Promise(resolve => setTimeout(resolve, 300))
      await window.cashonize.request({ method: 'bch_cancelPendingRequests', params: {} })
      window.queuedResponses = [window.cashonize.send({ jsonrpc: '2.0', id: 52, method: 'bch_signMessage', params: { message: 'after the cancel' } })]
      return (await signing).error?.code
    }, txFixture)
    expect(outcome).toBe(5000)

    const popup = await opening
    const dialog = await waitForDialog(popup, 30_000)
    await expect(dialog).toContainText('after the cancel')
    await expect(popup.locator('.q-dialog:visible')).toHaveCount(1)
    expect(await activityCount(popup)).toBe(before)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(() => popup.isClosed(), { timeout: 10_000 }).toBe(true)

    walletPage = await context.newPage()
    await walletPage.goto(extensionUrl)
    await walletPage.locator('nav').waitFor({ timeout: 30_000 })
  })

  test('a disconnect from the wallet reaches the dApp and ends the auto-approval', async () => {
    await walletPage.locator('nav').getByText('Connect', { exact: true }).click()
    await walletPage.locator('.bex-session-card').getByRole('img', { name: 'Disconnect' }).click()
    await expect.poll(() => dappPage.evaluate(() => window.cashonize.connected())).toBe(false)
    const events = await connectorEvents()
    expect(events.at(-2)).toEqual(['addressChanged', undefined])
    expect(events.at(-1)?.[0]).toBe('disconnect')

    const connecting = dappPage.evaluate(() => window.cashonize.connect())
    const connectDialog = await waitForDialog(walletPage)
    await connectDialog.locator('.address-item').first().click()
    await connectDialog.getByRole('button', { name: 'Approve' }).click()
    await connecting

    const signing = signLibauthTransaction(dappPage)
    const dialog = await waitForDialog(walletPage)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await signing).toBeUndefined()
  })
})
