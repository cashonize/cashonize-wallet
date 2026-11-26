// The provider as a WC2-BCH connector (IConnector in @bch-wc2/interfaces): a dApp that drives
// WalletConnect or an injected wallet through that interface works with window.cashonize as is,
// passing its libauth objects, and a site the user auto-approves signs its transactions unprompted.

import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { SignedMessage } from '@cashonize/bch-wallet-lib'
import { DAPP_URL, setupWalletOnChipnet, waitForDialog } from '../helpers'
import { txFixture } from '../test-dapp/src/fixtures'
import { launchExtension, waitForToolbarPopup } from './extension'

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
    // A prompt left open counts as no answer, so an unexpected dialog fails early. The time counts
    // from the request, so it also covers the wallet loading its coins before a dialog, an electrum
    // failover included
    return Promise.race([
      window.cashonize.signTransaction(revive(fixture)),
      new Promise(resolve => setTimeout(() => resolve('no answer within 30 s'), 30_000)),
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

// the app lock's PIN in the lock tests
const pin = '2468'
async function enterPin(scope: Locator, button: string) {
  await scope.getByLabel('PIN', { exact: true }).fill(pin)
  await scope.getByRole('button', { name: button }).click()
}
async function openAppLock(page: Page) {
  await page.locator('nav').getByLabel('Menu').click()
  await page.getByText('App lock', { exact: true }).first().click()
}

// whether the dApp has had an answer to the request it sent last
const answered = () => dappPage.evaluate(() => Promise.race([
  window.queuedResponses![0]!.then(() => true),
  new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100)),
]))
const signedHash = () => dappPage.evaluate(async () =>
  ((await window.queuedResponses![0]!).result as { signedTransactionHash?: string } | undefined)?.signedTransactionHash)

// the count of waiting requests on the extension's toolbar icon
const badgeText = () => context.serviceWorkers().find(worker => worker.url().endsWith('/background.js'))!
  .evaluate(() => (globalThis as unknown as { chrome: { action: { getBadgeText(details: object): Promise<string> } } })
    .chrome.action.getBadgeText({}))

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

    // an auto-approved request needs the user for nothing, so the wallet page stays where it is
    await dappPage.bringToFront()
    await expect.poll(walletInFront).toBe(false)
    const signed = await signLibauthTransaction(dappPage) as { signedTransactionHash?: string }
    expect(signed.signedTransactionHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await walletInFront()).toBe(false)
    await expect(walletPage.locator('.q-dialog:visible')).toHaveCount(0)

    // a message is never auto-approved, and brings the wallet page up for it
    const message = dappPage.evaluate(() => window.cashonize.signMessage({ message: 'still asked' }))
    const dialog = await waitForDialog(walletPage)
    await expect(dialog).toContainText('still asked')
    await expect.poll(walletInFront).toBe(true)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await message).toBeUndefined()
  })

  // A fresh toolbar popup is still loading the wallet when the dApp withdraws; a second request
  // keeps the popup open, where a handler that missed the cancel would go on to sign
  test('signs no request the dApp withdrew, auto-approved ones included', async () => {
    const before = await activityCount(walletPage)
    await walletPage.close()
    const outcome = await dappPage.evaluate(async (fixture) => {
      const signing = window.cashonize.send({ jsonrpc: '2.0', id: 51, method: 'bch_signTransaction', params: fixture })
      await new Promise(resolve => setTimeout(resolve, 300))
      const { cancelledCount } = await window.cashonize.cancelPendingRequests()
      window.queuedResponses = [window.cashonize.send({ jsonrpc: '2.0', id: 52, method: 'bch_signMessage', params: { message: 'after the cancel' } })]
      return { cancelledCount, code: (await signing).error?.code }
    }, txFixture)
    expect(outcome).toEqual({ cancelledCount: 1, code: 5000 })

    const popup = await waitForToolbarPopup(context)
    await expect.poll(() => popup.dialogs(), { timeout: 30_000 }).toEqual([expect.stringContaining('after the cancel')])
    expect(await popup.evaluate<number>(`Object.keys(localStorage).filter(key => key.startsWith('dappActivity-'))
      .reduce((count, key) => count + JSON.parse(localStorage.getItem(key) ?? '[]').length, 0)`)).toBe(before)
    await popup.clickInDialog('after the cancel', 'Cancel')
    await expect.poll(() => popup.isOpen(), { timeout: 10_000 }).toBe(false)

    walletPage = await context.newPage()
    await walletPage.goto(extensionUrl)
    await walletPage.locator('nav').waitFor({ timeout: 30_000 })
  })

  // A popup woken for an auto-approval loads the wallet before it can sign: it says what it is
  // doing meanwhile, and closes once it signed
  test('says at once what a popup woken for an auto-approval is doing, and closes it once signed', async () => {
    await walletPage.close()
    await dappPage.evaluate((fixture) => {
      window.queuedResponses = [window.cashonize.send({ jsonrpc: '2.0', id: 53, method: 'bch_signTransaction', params: fixture })]
    }, txFixture)
    const popup = await waitForToolbarPopup(context)
    // titled as auto-approving, it names the action and the site as the transaction dialog does
    const notice = () => popup.evaluate<{ text: string; icon?: string } | null>(`(() => {
      const dialog = document.querySelector('.q-dialog')
      return dialog && { text: dialog.innerText, icon: dialog.querySelector('img')?.src }
    })()`)
    await expect.poll(notice).toEqual({
      // the legend is set in capitals, which innerText reads as shown
      text: expect.stringMatching(/Auto-Approving Transaction[\s\S]*Test transaction[\s\S]*Bitcoin Cash WalletConnect Test dApp[\s\S]*http:\/\/localhost:5188/i),
      icon: 'http://localhost:5188/icon.png',
    })
    expect(await signedHash()).toMatch(/^[0-9a-f]{64}$/)
    await expect.poll(() => popup.isOpen(), { timeout: 10_000 }).toBe(false)

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

  test('shares one unlock among the extension\'s pages, and one lock', async () => {
    await openAppLock(walletPage)
    await walletPage.locator('#newPin').fill(pin)
    await walletPage.locator('#repeatPin').fill(pin)
    await walletPage.getByRole('button', { name: 'Turn on app lock' }).click()

    // a page opened while another is unlocked opens unlocked
    const secondPage = await context.newPage()
    await secondPage.goto(extensionUrl)
    await secondPage.locator('nav').waitFor({ timeout: 30_000 })
    await expect(secondPage.locator('.lock-screen')).toHaveCount(0)

    await openAppLock(secondPage)
    await secondPage.getByText('Lock now', { exact: true }).click()
    await expect(walletPage.locator('.lock-screen')).toBeVisible()

    // The toolbar popup has one size, locked or showing the wallet: the lock screen alone gave it
    // none, and the wallet widened it as it rendered
    const worker = context.serviceWorkers().find(candidate => candidate.url().endsWith('/background.js'))!
    async function toolbarPopupSize(showing: string) {
      await worker.evaluate(() => (globalThis as unknown as { chrome: { action: { openPopup(): Promise<void> } } })
        .chrome.action.openPopup())
      const popup = await waitForToolbarPopup(context)
      await expect.poll(() => popup.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(showing)})`)).toBe(true)
      const size = await popup.evaluate<number[]>('[innerWidth, innerHeight]')
      await popup.evaluate('window.close()').catch(() => { /* the popup goes away with the call */ })
      await expect.poll(() => popup.isOpen()).toBe(false)
      return size
    }
    const [lockedWidth, lockedHeight] = await toolbarPopupSize('.lock-screen')
    expect(lockedWidth).toBeLessThan(450)
    expect(lockedHeight).toBeGreaterThanOrEqual(400)

    await enterPin(secondPage.locator('.lock-screen'), 'Unlock')
    await expect(walletPage.locator('.lock-screen')).toHaveCount(0)
    await secondPage.close()

    const [walletWidth] = await toolbarPopupSize('nav')
    expect(walletWidth).toBe(lockedWidth)
    // a tab keeps the window's width
    expect(await walletPage.evaluate(() => innerWidth)).toBeGreaterThan(450)
  })

  // Auto-approval stops behind the lock: a transaction sent then is shown once unlocked, as anyone
  // at the device can make a dApp send one, and only what comes after the unlock signs unasked
  test('holds what was sent behind the lock for the user, and auto-approves what comes after the unlock', async () => {
    // a request withdrawn while its PIN is typed takes the PIN dialog with it, and says so
    await dappPage.evaluate((fixture) => {
      window.queuedResponses = [window.cashonize.send({ jsonrpc: '2.0', id: 60, method: 'bch_signTransaction', params: fixture })]
    }, txFixture)
    await (await waitForDialog(walletPage)).getByRole('button', { name: 'Sign' }).click()
    await expect(walletPage.locator('.pin-dialog')).toBeVisible()
    await dappPage.evaluate(() => window.cashonize.request({ method: 'bch_cancelPendingRequests', params: {} }))
    const withdrawn = walletPage.locator('.q-dialog', { hasText: 'withdrew this request' })
    await expect(withdrawn).toContainText('http://localhost:5188')
    await expect(walletPage.locator('.pin-dialog')).toHaveCount(0)
    await withdrawn.getByRole('button', { name: 'OK' }).click()

    // the site's settings grant auto-approve, so they open behind the PIN
    await walletPage.locator('nav').getByText('Connect', { exact: true }).click()
    await walletPage.locator('.bex-session-card .dapp-session-settings').click()
    await enterPin(await waitForDialog(walletPage), 'Confirm')
    const settings = await waitForDialog(walletPage)
    await settings.locator('.q-toggle').click()
    await expect(settings.locator('input[type="radio"][value="forever"]')).toBeChecked()
    await walletPage.keyboard.press('Escape')
    await expect(walletPage.locator('.q-dialog')).toHaveCount(0)

    await openAppLock(walletPage)
    await walletPage.getByText('Lock now', { exact: true }).click()
    const lockScreen = walletPage.locator('.lock-screen')
    await expect(lockScreen).toBeVisible()

    const before = await activityCount(walletPage)
    await dappPage.bringToFront()
    await expect.poll(walletInFront).toBe(false)
    await dappPage.evaluate((fixture) => {
      window.queuedResponses = [window.cashonize.send({ jsonrpc: '2.0', id: 61, method: 'bch_signTransaction', params: fixture })]
    }, txFixture)
    // the page asks to come up for the unlock as it takes the request, which an auto-approval
    // would answer within moments
    await expect.poll(walletInFront).toBe(true)
    await walletPage.waitForTimeout(2_000)
    expect(await answered()).toBe(false)
    await expect(walletPage.locator('.q-dialog')).toHaveCount(0)
    expect(await activityCount(walletPage)).toBe(before)
    expect(await badgeText()).toBe('1')

    await enterPin(lockScreen, 'Unlock')
    const held = walletPage.locator('.q-dialog', { hasText: 'Test transaction' })
    await held.getByRole('button', { name: 'Sign' }).click()
    await enterPin(walletPage.locator('.q-dialog', { has: walletPage.locator('.pin-dialog') }), 'Confirm')
    expect(await signedHash()).toMatch(/^[0-9a-f]{64}$/)
    await expect.poll(badgeText).toBe('')

    // what the site sends from now on is auto-approved
    await dappPage.evaluate((fixture) => {
      window.queuedResponses = [window.cashonize.send({ jsonrpc: '2.0', id: 62, method: 'bch_signTransaction', params: fixture })]
    }, txFixture)
    expect(await signedHash()).toMatch(/^[0-9a-f]{64}$/)
    await expect(walletPage.locator('.q-dialog')).toHaveCount(0)
  })
})
