// The extension on mainnet, with a new wallet and no funds: a dApp that names mainnet connects and
// one that needs chipnet is refused, a message is signed, and a transaction is signed without a
// broadcast in an approval window that first loads the wallet from mainnet's servers.

import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { SignedMessage } from '@cashonize/bch-wallet-lib'
import { DAPP_URL, expectReceiveAddress, waitForDialog } from '../helpers'
import { txFixture } from '../test-dapp/src/fixtures'
import { launchExtension, waitForToolbarPopup } from './extension'

let context: BrowserContext
let closeExtension: (() => Promise<void>) | undefined
let walletPage: Page
let dappPage: Page
let address: string | undefined
const pageErrors: string[] = []

test.describe.serial('Cashonize BEX — on mainnet', () => {
  test.beforeAll(async () => {
    const launched = await launchExtension()
    context = launched.context
    closeExtension = launched.close
    walletPage = await context.newPage()
    walletPage.on('pageerror', error => pageErrors.push(error.message))
    // the onboarding makes a mainnet wallet
    await walletPage.goto(launched.extensionUrl)
    await walletPage.getByRole('button', { name: 'Create new wallet' }).click()
    await walletPage.getByRole('button', { name: 'Create wallet' }).click()
    await walletPage.getByRole('button', { name: 'Finish Setup' }).click()
    await expectReceiveAddress(walletPage, /^bitcoincash:/)

    dappPage = await context.newPage()
    await dappPage.goto(DAPP_URL)
    await expect(dappPage.locator('#bex-provider-status')).toHaveText('available', { timeout: 15_000 })
  })

  test.afterAll(async () => {
    await closeExtension?.()
  })

  test('connects a dApp that names mainnet', async () => {
    expect(await dappPage.evaluate(() => window.cashonize.request({ method: 'bch_getNetwork', params: {} })))
      .toEqual({ chainId: 'bch:bitcoincash', network: 'mainnet' })
    const connecting = dappPage.evaluate(() => window.cashonize.connect({ chainId: 'bch:bitcoincash' }))
    const dialog = await waitForDialog(walletPage)
    await dialog.locator('.address-item').first().click()
    await dialog.getByRole('button', { name: 'Approve' }).click()
    await connecting
    address = await dappPage.evaluate(() => window.cashonize.address())
    expect(address).toMatch(/^bitcoincash:/)
  })

  test('refuses a dApp that needs chipnet', async () => {
    const refusing = dappPage.evaluate(() => window.cashonize.send({
      jsonrpc: '2.0', id: 1, method: 'bch_requestAccounts', params: { chainId: 'bch:bchtest' },
    }))
    const dialog = await waitForDialog(walletPage)
    await expect(dialog).toContainText('chipnet')
    await dialog.getByRole('button', { name: 'OK' }).click()
    expect((await refusing).error?.code).toBe(4901)
  })

  test('signs a message', async () => {
    const signing = dappPage.evaluate(() => window.cashonize.signMessage({ message: 'on mainnet' }))
    const dialog = await waitForDialog(walletPage)
    await dialog.getByRole('button', { name: 'Sign' }).click()
    expect(SignedMessage.verify('on mainnet', await signing as string, address!).valid).toBe(true)
  })

  test('signs a transaction in the toolbar popup, without broadcasting it', async () => {
    await walletPage.close()
    const signing = dappPage.evaluate(fixture =>
      window.cashonize.request({ method: 'bch_signTransaction', params: fixture }), txFixture)
    const popup = await waitForToolbarPopup(context)
    // shown once the popup has the wallet's coins and has run its identity checks
    await popup.clickInDialog('Test transaction', 'Sign', 90_000)
    const signed = await signing as { signedTransaction: string; signedTransactionHash: string }
    expect(signed.signedTransaction).toMatch(/^[0-9a-f]+$/)
    expect(signed.signedTransactionHash).toMatch(/^[0-9a-f]{64}$/)
    expect(popup.errors).toEqual([])
    expect(pageErrors).toEqual([])
  })
})
