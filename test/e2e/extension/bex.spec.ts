import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { DAPP_URL, setupWalletOnChipnet, waitForDialog } from '../helpers'
import { launchExtension, stopExtensionServiceWorker as stopWorker, type Wc2Response } from './extension'

let context: BrowserContext
let closeExtension: (() => Promise<void>) | undefined
let walletPage: Page
let dappPage: Page
const pageErrors: string[] = []
const cspErrors: string[] = []

// Fire several requests at once; the wallet must present them one after another.
async function queueSignMessageRequests(requests: Array<{ id: number, message: string }>) {
  await dappPage.evaluate((list) => {
    window.queuedResponses = list.map(({ id, message }) => window.cashonize.send({
      jsonrpc: '2.0',
      id,
      method: 'bch_signMessage',
      params: { message },
    }))
  }, requests)
}

async function queuedResponses(): Promise<Wc2Response[]> {
  return dappPage.evaluate(async () => Promise.all(window.queuedResponses ?? []))
}

function stopExtensionServiceWorker() {
  return stopWorker(context)
}

test.describe.serial('Cashonize BEX — WC2 session and WC2 JSON-RPC transport', () => {
  test.beforeAll(async () => {
    const launched = await launchExtension()
    context = launched.context
    closeExtension = launched.close
    const extensionUrl = launched.extensionUrl

    walletPage = await context.newPage()
    walletPage.on('pageerror', (error) => pageErrors.push(error.message))
    walletPage.on('console', (message) => {
      if (message.type() === 'error' && /Content Security Policy|Refused to/i.test(message.text())) {
        cspErrors.push(message.text())
      }
    })


    await setupWalletOnChipnet(walletPage, undefined, extensionUrl)

    dappPage = await context.newPage()
    await dappPage.goto(DAPP_URL)
    await expect(dappPage.locator('#bex-provider-status')).toHaveText('available', { timeout: 15_000 })
  })

  test.afterAll(async () => {
    await closeExtension?.()
  })

  test('boots, creates a wallet, and persists it across a reload', async () => {
    const testInfo = test.info()
    const address = await walletPage.locator('.depositAddr').first().innerText()
    expect(address).toMatch(/^bchtest:/)
    expect(pageErrors).toEqual([])
    expect(cspErrors).toEqual([])

    await walletPage.screenshot({ path: testInfo.outputPath('extension-wallet.png'), fullPage: true })

    await walletPage.reload()
    await walletPage.locator('.depositAddr').first().waitFor({ timeout: 30_000 })
    expect(await walletPage.locator('.depositAddr').first().innerText()).toBe(address)
    expect(pageErrors).toEqual([])
    expect(cspErrors).toEqual([])
  })

  test('bch_requestAccounts authorizes the origin and sets provider state', async () => {
    await expect(dappPage.locator('#bex-is-connected')).toHaveText('false')

    const pending = dappPage.evaluate(() => window.cashonize.request({
      method: 'bch_requestAccounts',
      params: {
        dappMetadata: {
          name: 'BCH Test DApp',
          description: 'Playwright fixture for Cashonize',
          url: 'http://localhost:5188',
          icons: [`${location.origin}/icon.png`],
        },
      },
    }))
    const dialog = await waitForDialog(walletPage)
    await expect(dialog).toContainText('BCH Test DApp')
    await walletPage.locator('.q-dialog .address-item').first().click()
    await dialog.getByRole('button', { name: 'Approve' }).click()

    const accounts = await pending as string[]
    expect(accounts[0]).toMatch(/^bchtest:/)
    expect(await dappPage.evaluate(() => window.cashonize.isConnected())).toBe(true)
    expect(await dappPage.evaluate(() => window.cashonize.chainId)).toBe('bch:bchtest')
    expect(await dappPage.evaluate(() => window.cashonize.selectedAddress)).toMatch(/^bchtest:/)
    expect(await dappPage.evaluate(() => window.cashonize.request({ method: 'bch_getNetwork', params: {} }))).toEqual({
      chainId: 'bch:bchtest',
      network: 'chipnet',
    })
    await expect(dappPage.locator('#bex-chain-id')).toHaveText('bch:bchtest')
    await expect(dappPage.locator('#bex-selected-address')).toHaveText(/^bchtest:/)
    await expect(dappPage.locator('#bex-is-connected')).toHaveText('true')
    await expect(dappPage.locator('#bex-events')).toContainText('accountsChanged')
  })

  test('exposes the same provider as window.cashonize and window.bitcoincash', async () => {
    expect(await dappPage.evaluate(() => window.bitcoincash === window.cashonize)).toBe(true)
    expect(await dappPage.evaluate(() => window.bitcoincash.isBitcoinCash)).toBe(true)

    const accounts = await dappPage.evaluate(() => window.bitcoincash.request({
      method: 'bch_getAddresses',
      params: {},
    }))
    expect(Array.isArray(accounts)).toBe(true)
    expect((accounts as string[])[0]).toMatch(/^bchtest:/)
  })

  test('announces itself through BCH provider discovery', async () => {
    await expect(dappPage.locator('#bex-discovered-count')).toHaveText('1')
    await expect(dappPage.locator('#bex-discovered-providers')).toContainText('Cashonize')
    await expect(dappPage.locator('#bex-discovered-providers')).toContainText('com.cashonize.wallet')

    const discovered = await dappPage.evaluate(() => new Promise<Array<{
      name: string
      rdns: string
      hasRequest: boolean
    }>>((resolve) => {
      const found: Array<{ name: string; rdns: string; hasRequest: boolean }> = []
      const onAnnounce = (event: Event) => {
        const detail = (event as CustomEvent).detail as {
          info: { name: string; rdns: string }
          provider: { request?: unknown }
        }
        found.push({
          name: detail.info.name,
          rdns: detail.info.rdns,
          hasRequest: typeof detail.provider.request === 'function',
        })
      }
      window.addEventListener('bitcoincash:announceProvider', onAnnounce)
      window.dispatchEvent(new Event('bitcoincash:requestProvider'))
      window.removeEventListener('bitcoincash:announceProvider', onAnnounce)
      resolve(found)
    }))

    expect(discovered).toEqual([
      { name: 'Cashonize', rdns: 'com.cashonize.wallet', hasRequest: true },
    ])
  })

  test('lists the browser provider in the Connect tab', async () => {
    const testInfo = test.info()
    await walletPage.locator('nav').getByText('Connect', { exact: true }).click()
    await expect(walletPage.getByText('Browser provider')).toBeVisible({ timeout: 15_000 })
    await expect(walletPage.locator('.bex-session-card .dapp-session-name')).toHaveText('BCH Test DApp')
    const originLink = walletPage.locator('.bex-session-card .dapp-session-url')
    await expect(originLink).toHaveText('http://localhost:5188')
    await expect(originLink).toHaveAttribute('href', 'http://localhost:5188/')
    await expect(walletPage.locator('.bex-session-card .dapp-session-description')).toHaveText('Playwright fixture for Cashonize')
    await expect(walletPage.locator('.bex-session-card .dapp-session-icon')).toHaveAttribute('src', 'http://localhost:5188/icon.png')
    await expect(walletPage.locator('.bex-session-card .connected-address')).toHaveCount(1)
    await expect(walletPage.locator('.bex-session-card').getByRole('img', { name: 'Disconnect' })).toBeVisible()
    await walletPage.screenshot({ path: testInfo.outputPath('connect-browser-provider.png'), fullPage: true })
  })

  test('restores the site connection when the dApp tab is reopened', async () => {
    const address = await dappPage.locator('#bex-selected-address').innerText()
    await dappPage.close()

    dappPage = await context.newPage()
    await dappPage.goto(DAPP_URL)
    await expect(dappPage.locator('#bex-provider-status')).toHaveText('available', { timeout: 15_000 })
    await expect(dappPage.locator('#bex-is-connected')).toHaveText('true')
    await expect(dappPage.locator('#bex-selected-address')).toHaveText(address)
  })

  test('speaks WC2 JSON-RPC envelopes over the extension transport', async () => {
    const response = await dappPage.evaluate(() => window.cashonize.send({
      jsonrpc: '2.0',
      id: 42,
      method: 'bch_getAddresses',
      params: {},
    }))

    expect(response.jsonrpc).toBe('2.0')
    expect(response.id).toBe(42)
    expect(response.error).toBeUndefined()
    expect(Array.isArray(response.result)).toBe(true)
    expect((response.result as string[])[0]).toMatch(/^bchtest:/)
  })

  test('bch_getAddresses returns the wallet address', async () => {
    await dappPage.click('#bex-btn-get-addresses')
    await expect(dappPage.locator('#bex-response')).toContainText('bchtest:', { timeout: 20_000 })
  })

  test('bch_signMessage approves and rejects', async () => {
    await dappPage.click('#bex-btn-sign-message')
    let dialog = await waitForDialog(walletPage)
    await expect(dialog).toContainText('Hello BCH')
    await expect(dialog).toContainText('BCH Test DApp')
    await dialog.getByRole('button', { name: 'Sign' }).click()

    await expect(dappPage.locator('#bex-response')).toHaveText(/.{10,}/, { timeout: 20_000 })
    const approved = await dappPage.locator('#bex-response').innerText()
    expect(approved).not.toContain('"error"')
    expect(approved.length).toBeGreaterThan(10)

    await dappPage.click('#bex-btn-sign-message')
    dialog = await waitForDialog(walletPage)
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await expect(dappPage.locator('#bex-response')).toContainText('"error"', { timeout: 20_000 })
    await expect(dappPage.locator('#bex-response')).toContainText('5000')
  })

  test('bch_signMessage returns WC2 envelopes for approval and rejection', async () => {
    const approved = dappPage.evaluate(() => window.cashonize.send({
      jsonrpc: '2.0',
      id: 77,
      method: 'bch_signMessage',
      params: { message: 'Hello BCH', userPrompt: 'Sign this message' },
    }))
    let dialog = await waitForDialog(walletPage)
    await dialog.getByRole('button', { name: 'Sign' }).click()
    const approvedResponse = await approved
    expect(approvedResponse.jsonrpc).toBe('2.0')
    expect(approvedResponse.id).toBe(77)
    expect(approvedResponse.error).toBeUndefined()
    expect(typeof approvedResponse.result).toBe('string')
    expect((approvedResponse.result as string).length).toBeGreaterThan(10)

    const rejected = dappPage.evaluate(() => window.cashonize.send({
      jsonrpc: '2.0',
      id: 78,
      method: 'bch_signMessage',
      params: { message: 'Hello BCH' },
    }))
    dialog = await waitForDialog(walletPage)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    const rejectedResponse = await rejected
    expect(rejectedResponse.jsonrpc).toBe('2.0')
    expect(rejectedResponse.id).toBe(78)
    expect(rejectedResponse.result).toBeUndefined()
    expect(rejectedResponse.error?.code).toBe(5000)
  })

  test('bch_signTransaction approves and rejects', async () => {
    const testInfo = test.info()
    await dappPage.click('#bex-btn-sign-transaction')
    let dialog = await waitForDialog(walletPage)
    await walletPage.waitForTimeout(300)
    await dialog.screenshot({ path: testInfo.outputPath('transaction-approval.png') })
    await dialog.getByRole('button', { name: 'Sign' }).click()

    await expect(dappPage.locator('#bex-response')).toContainText('signedTransaction', { timeout: 20_000 })
    const response = await dappPage.locator('#bex-response').innerText()
    const signed = JSON.parse(response) as { signedTransaction: string; signedTransactionHash: string }
    expect(signed.signedTransaction).toMatch(/^[0-9a-f]+$/)
    expect(signed.signedTransactionHash).toMatch(/^[0-9a-f]{64}$/)

    await dappPage.click('#bex-btn-sign-transaction')
    dialog = await waitForDialog(walletPage)
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await expect(dappPage.locator('#bex-response')).toContainText('"error"', { timeout: 20_000 })
    await expect(dappPage.locator('#bex-response')).toContainText('5000')
  })

  test('bch_cancelPendingRequests dismisses a pending approval', async () => {
    await dappPage.click('#bex-btn-sign-transaction')
    const dialog = await waitForDialog(walletPage)

    const cancelResult = await dappPage.evaluate(() => window.cashonize.request({
      method: 'bch_cancelPendingRequests',
      params: {},
    }))
    expect(cancelResult).toEqual({ cancelledCount: 1 })

    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(dappPage.locator('#bex-response')).toContainText('cancelled', { timeout: 20_000 })
  })

  test('presents queued requests one at a time in arrival order', async () => {
    await queueSignMessageRequests([
      { id: 501, message: 'Queue first' },
      { id: 502, message: 'Queue second' },
    ])

    const firstDialog = await waitForDialog(walletPage)
    await expect(firstDialog).toContainText('Queue first')
    await expect(firstDialog).not.toContainText('Queue second')
    await firstDialog.getByRole('button', { name: 'Sign' }).click()

    const secondDialog = await waitForDialog(walletPage)
    await expect(secondDialog).toContainText('Queue second')
    await secondDialog.getByRole('button', { name: 'Sign' }).click()

    const responses = await queuedResponses()
    expect(responses.map(response => response.id)).toEqual([501, 502])
    for (const response of responses) expect(response.error).toBeUndefined()
  })

  test('resumes the queue after a wallet page reload', async () => {
    await queueSignMessageRequests([
      { id: 511, message: 'Reload first' },
      { id: 512, message: 'Reload second' },
    ])

    const firstDialog = await waitForDialog(walletPage)
    await expect(firstDialog).toContainText('Reload first')

    await walletPage.reload()
    await walletPage.locator('nav').waitFor({ timeout: 30_000 })

    const resumedDialog = await waitForDialog(walletPage, 30_000)
    await expect(resumedDialog).toContainText('Reload first')
    await resumedDialog.getByRole('button', { name: 'Sign' }).click()

    const secondDialog = await waitForDialog(walletPage)
    await expect(secondDialog).toContainText('Reload second')
    await secondDialog.getByRole('button', { name: 'Sign' }).click()

    const responses = await queuedResponses()
    expect(responses.map(response => response.id)).toEqual([511, 512])
  })

  test('restores the queue after a service worker restart', async () => {
    await queueSignMessageRequests([
      { id: 531, message: 'Worker first' },
      { id: 532, message: 'Worker second' },
    ])
    const firstDialog = await waitForDialog(walletPage)
    await expect(firstDialog).toContainText('Worker first')

    // The worker keeps the queue only in chrome.storage.local; after a restart the answer to the
    // first dialog must still advance to the second request.
    await stopExtensionServiceWorker()
    await walletPage.waitForTimeout(2500)

    await firstDialog.getByRole('button', { name: 'Sign' }).click()

    const secondDialog = await waitForDialog(walletPage, 30_000)
    await expect(secondDialog).toContainText('Worker second')
    await secondDialog.getByRole('button', { name: 'Sign' }).click()

    const responses = await queuedResponses()
    expect(responses.map(response => response.id)).toEqual([531, 532])
  })

  test('pairs a WC2 dApp and approves its session', async () => {
    await walletPage.locator('nav').getByText('Connect', { exact: true }).click()
    await walletPage.getByText('Connect to dApp', { exact: true }).waitFor({ timeout: 15_000 })

    await dappPage.click('#btn-connect')
    await expect(dappPage.locator('#pairing-uri')).toContainText('wc:', { timeout: 20_000 })
    const uri = await dappPage.textContent('#pairing-uri')

    await walletPage.getByPlaceholder('Connection URI').fill(uri!)
    await walletPage.locator('input.primaryButton[value*="Connect"]').click()

    const approveButton = walletPage.getByRole('button', { name: 'Approve' })
    await approveButton.waitFor({ timeout: 30_000 })
    await walletPage.locator('.q-dialog .address-item').first().click()
    await approveButton.click()

    await expect(dappPage.locator('#session-status')).toHaveText('connected', { timeout: 30_000 })
    const session = await dappPage.locator('#response').innerText()
    expect(session).toContain('bch:bchtest')
    expect(session).toContain('bch_signTransaction')
    expect(session).toContain('bch_getAddresses')
    // The WalletConnect sessions and the browser provider share one card, so the site's metadata
    // and actions render the same way.
    await expect(walletPage.locator('.wc2sessions .dapp-session-name')).toContainText('BCH WC Test dApp')
    await expect(walletPage.locator('.wc2sessions .dapp-session-url')).toHaveAttribute('href', 'http://localhost:5188/')
    await expect(walletPage.locator('.wc2sessions .dapp-session-settings')).toBeVisible()
    await expect(walletPage.locator('.wc2sessions').getByRole('img', { name: 'Disconnect' })).toBeVisible()
  })

  test('WC2 bch_getAddresses returns the connected address', async () => {
    await dappPage.click('#btn-get-addresses')
    await expect(dappPage.locator('#response')).toContainText('bchtest:', { timeout: 20_000 })
  })

  test('WC2 bch_signMessage approves and rejects', async () => {
    await dappPage.click('#btn-sign-message')
    let dialog = await waitForDialog(walletPage)
    await expect(dialog).toContainText('Hello BCH')
    await dialog.getByRole('button', { name: 'Sign' }).click()

    await expect(dappPage.locator('#response')).toHaveText(/.+/, { timeout: 20_000 })
    const approved = await dappPage.locator('#response').innerText()
    expect(approved).not.toContain('"error"')
    expect(approved.length).toBeGreaterThan(10)

    await dappPage.click('#btn-sign-message')
    dialog = await waitForDialog(walletPage)
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await expect(dappPage.locator('#response')).toContainText('"error"', { timeout: 20_000 })
  })

  test('WC2 bch_signTransaction approves and rejects', async () => {
    await dappPage.click('#btn-sign-transaction')
    let dialog = await waitForDialog(walletPage)
    await dialog.getByRole('button', { name: 'Sign' }).click()

    await expect(dappPage.locator('#response')).toContainText('signedTransaction', { timeout: 20_000 })
    const signed = JSON.parse(await dappPage.locator('#response').innerText()) as {
      signedTransaction: string
      signedTransactionHash: string
    }
    expect(signed.signedTransaction).toMatch(/^[0-9a-f]+$/)
    expect(signed.signedTransactionHash).toMatch(/^[0-9a-f]{64}$/)

    await dappPage.click('#btn-sign-transaction')
    dialog = await waitForDialog(walletPage)
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await expect(dappPage.locator('#response')).toContainText('"error"', { timeout: 20_000 })
  })

  test('WC2 bch_cancelPendingRequests dismisses a pending approval', async () => {
    await dappPage.click('#btn-sign-transaction')
    const dialog = await waitForDialog(walletPage)

    await dappPage.click('#btn-cancel-pending')

    await expect(dialog).toBeHidden({ timeout: 20_000 })
    await expect(dappPage.locator('#response')).toContainText('cancelledCount', { timeout: 20_000 })
  })

  test('keeps the WC2 session across an extension page reload', async () => {
    await walletPage.reload()
    await walletPage.locator('nav').waitFor({ timeout: 30_000 })
    await walletPage.locator('nav').getByText('Connect', { exact: true }).click()
    await walletPage.getByText('Connect to dApp', { exact: true }).waitFor({ timeout: 20_000 })
    await expect(walletPage.getByText('BCH WC Test dApp')).toBeVisible({ timeout: 20_000 })

    await dappPage.click('#btn-get-addresses')
    await expect(dappPage.locator('#response')).toContainText('bchtest:', { timeout: 20_000 })
  })

  test('opens a popup window for a request when no wallet page is open', async () => {
    const testInfo = test.info()
    await walletPage.close()
    await dappPage.waitForTimeout(500)
    await expect(dappPage.locator('#bex-is-connected')).toHaveText('true')
    await expect(dappPage.locator('#bex-selected-address')).toHaveText(/^bchtest:/)
    await expect(dappPage.locator('#bex-events')).not.toContainText('disconnect')

    const popupPromise = context.waitForEvent('page', { timeout: 30_000 })
    await dappPage.click('#bex-btn-sign-message')
    const popupPage = await popupPromise
    await popupPage.waitForLoadState('domcontentloaded')
    expect(popupPage.url()).toContain('chrome-extension://')


    const dialog = await waitForDialog(popupPage, 30_000)
    await expect(dialog).toContainText('Hello BCH')
    await popupPage.screenshot({ path: testInfo.outputPath('approval-popup.png') })
    await dialog.getByRole('button', { name: 'Sign' }).click()

    await expect(dappPage.locator('#bex-response')).toHaveText(/.{10,}/, { timeout: 20_000 })
    const response = await dappPage.locator('#bex-response').innerText()
    expect(response).not.toContain('"error"')
    await expect.poll(() => popupPage.isClosed(), { timeout: 10_000 }).toBe(true)
  })

  test('keeps the approval popup open until the queue is empty', async () => {
    if (!walletPage.isClosed()) await walletPage.close()
    await dappPage.waitForTimeout(500)

    const popupPromise = context.waitForEvent('page', { timeout: 30_000 })
    await queueSignMessageRequests([
      { id: 521, message: 'Popup first' },
      { id: 522, message: 'Popup second' },
    ])
    const popupPage = await popupPromise
    await popupPage.waitForLoadState('domcontentloaded')

    const firstDialog = await waitForDialog(popupPage, 30_000)
    await expect(firstDialog).toContainText('Popup first')
    await firstDialog.getByRole('button', { name: 'Sign' }).click()

    const secondDialog = await waitForDialog(popupPage, 30_000)
    await expect(secondDialog).toContainText('Popup second')
    expect(popupPage.isClosed()).toBe(false)
    await secondDialog.getByRole('button', { name: 'Sign' }).click()

    const responses = await queuedResponses()
    expect(responses.map(response => response.id)).toEqual([521, 522])
    for (const response of responses) expect(response.error).toBeUndefined()
    await expect.poll(() => popupPage.isClosed(), { timeout: 10_000 }).toBe(true)
  })

  test('answers read-only requests without opening the popup', async () => {
    await expect(dappPage.locator('#bex-is-connected')).toHaveText('true')

    const pagesBefore = context.pages().length
    await dappPage.click('#bex-btn-get-addresses')
    await expect(dappPage.locator('#bex-response')).toContainText('bchtest:', { timeout: 20_000 })
    await dappPage.waitForTimeout(300)
    expect(context.pages().length).toBe(pagesBefore)
  })

  test('disconnect button revokes the site without opening the popup', async () => {
    const pagesBefore = context.pages().length
    await dappPage.click('#bex-btn-disconnect')

    await expect(dappPage.locator('#bex-is-connected')).toHaveText('false', { timeout: 20_000 })
    await expect(dappPage.locator('#bex-selected-address')).toHaveText('')
    await expect(dappPage.locator('#bex-events')).toContainText('disconnect', { timeout: 20_000 })
    await dappPage.waitForTimeout(300)
    expect(context.pages().length).toBe(pagesBefore)
  })
})
