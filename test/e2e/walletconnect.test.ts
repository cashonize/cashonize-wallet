// WalletConnect E2E tests for Cashonize Wallet.
// If a seed phrase is provided in the E2E_SEED_PHRASE environment variable or top level .env file,
// the test will import that wallet. Otherwise a new wallet will be created.

import { test, expect, type Page } from '@playwright/test'
import { DAPP_URL, waitForDialog, setupWalletOnChipnet } from './helpers'

let walletPage: Page
let dappPage: Page

test.describe.serial('WalletConnect E2E', () => {
  test.beforeAll(async ({ browser }) => {
    const walletContext = await browser.newContext()
    const dappContext = await browser.newContext()
    walletPage = await walletContext.newPage()
    dappPage = await dappContext.newPage()

    // Install fake clocks before any WC code runs so we can fast-forward in the expiry test
    await walletPage.clock.install()
    await dappPage.clock.install()

    // Set up wallet via onboarding and switch to chipnet
    await setupWalletOnChipnet(walletPage)

    // Navigate to WalletConnect tab, wait for sessions section
    await walletPage.locator('nav').getByText('WalletConnect').click()
    await walletPage.getByText('Connect to Dapp').waitFor({ timeout: 15_000 })

    // Open test dApp, wait for SignClient to initialize (Connect button enabled)
    await dappPage.goto(DAPP_URL)
    await dappPage.locator('#btn-connect:not([disabled])').waitFor({ timeout: 15_000 })
  })

  test.afterAll(async () => {
    await walletPage?.context().close()
    await dappPage?.context().close()
  })

  test('connect', async () => {
    // dApp: Click Connect and wait for pairing URI
    await dappPage.click('#btn-connect')
    await expect(dappPage.locator('#pairing-uri')).toContainText('wc:', { timeout: 15_000 })
    const uri = await dappPage.textContent('#pairing-uri')

    // Wallet: Paste URI into WalletConnect input and click Connect
    await walletPage.getByPlaceholder('Wallet Connect URI').fill(uri!)
    await walletPage.locator('input.primaryButton[value*="Connect"]').click()

    // Wallet: Approve session proposal
    const approveButton = walletPage.getByRole('button', { name: 'Approve' })
    await approveButton.waitFor({ timeout: 15_000 })
    await approveButton.click()

    // dApp: Assert connected
    await expect(dappPage.locator('#session-status')).toHaveText('connected', { timeout: 15_000 })
  })

  test('getAddresses', async () => {
    await dappPage.click('#btn-get-addresses')

    // bch_getAddresses auto-responds, no dialog
    await expect(dappPage.locator('#response')).toContainText('bchtest:', { timeout: 15_000 })
  })

  test('signMessage — approve', async () => {
    await dappPage.click('#btn-sign-message')

    // Wallet: Wait for sign message dialog, verify content
    const signDialog = await waitForDialog(walletPage)
    await expect(signDialog).toContainText('Hello BCH')

    // Click Sign
    await signDialog.getByRole('button', { name: 'Sign' }).click()

    // dApp: Wait for response, then assert it's a signature (no error)
    await expect(dappPage.locator('#response')).toHaveText(/.+/, { timeout: 15_000 })
    const response = await dappPage.textContent('#response')
    expect(response!.length).toBeGreaterThan(10)
    expect(response).not.toContain('error')
  })

  test('signMessage — reject', async () => {
    await dappPage.click('#btn-sign-message')

    // Wallet: Wait for dialog, click Cancel
    const signDialog = await waitForDialog(walletPage)
    await signDialog.getByRole('button', { name: 'Cancel' }).click()

    // dApp: Assert error response
    await expect(dappPage.locator('#response')).toContainText('error', { timeout: 15_000 })
  })

  test('signTransaction', async () => {
    await dappPage.click('#btn-sign-transaction')

    // Wallet: Wait for transaction dialog, click Sign
    const txDialog = await waitForDialog(walletPage)
    await txDialog.getByRole('button', { name: 'Sign' }).click()

    // dApp: Assert response contains signed transaction
    await expect(dappPage.locator('#response')).toContainText('signedTransaction', { timeout: 15_000 })
    await expect(dappPage.locator('#response')).toContainText('signedTransactionHash')

    // Wallet: Dismiss the "Transaction Signed" alert dialog
    const alertDialog = walletPage.locator('.alertDialog')
    await alertDialog.waitFor({ timeout: 5_000 })
    await walletPage.keyboard.press('Escape')
    await expect(alertDialog).not.toBeVisible({ timeout: 5_000 })
  })

  test('cancelPendingRequests', async () => {
    // dApp: Start a sign transaction request (opens dialog in wallet)
    await dappPage.click('#btn-sign-transaction')

    // Wallet: Wait for transaction dialog to appear
    const txDialog = await waitForDialog(walletPage)

    // dApp: Send cancel request
    await dappPage.click('#btn-cancel-pending')

    // Wallet: Dialog should be dismissed
    await expect(txDialog).not.toBeVisible({ timeout: 15_000 })

    // dApp: Cancel response should contain cancelledCount
    await expect(dappPage.locator('#response')).toContainText('cancelledCount', { timeout: 15_000 })
  })

  test('requestExpiry', async () => {
    // dApp sends a signMessage request
    await dappPage.click('#btn-sign-message')

    // Wallet: Wait for sign message dialog to appear
    await waitForDialog(walletPage)

    // Fast-forward past the WC request expiry on both pages.
    // NOTE: sign-client's default session-request expiry changed from 5 to 15 minutes in
    // sign-client@2.23.7. We intentionally do NOT override it on the dApp side, so this value
    // tracks the real default — if the default changes again, this test fails loudly rather
    // than masking the change behind a hidden override.
    await walletPage.clock.fastForward('15:00')
    await dappPage.clock.fastForward('15:00')

    // dApp: Should receive expiry error
    await expect(dappPage.locator('#response')).toContainText('Request expired', { timeout: 5_000 })

    // Wallet: Expiry notification should appear
    const expiryNotification = walletPage.locator('.q-notification.bg-negative')
    await expect(expiryNotification).toContainText('Request expired', { timeout: 5_000 })
    await expect(expiryNotification).toBeInViewport()
  })

  test('disconnect', async () => {
    await dappPage.click('#btn-disconnect')

    // dApp: Assert disconnected
    await expect(dappPage.locator('#session-status')).toHaveText('disconnected', { timeout: 15_000 })

    // Wallet: Assert no active sessions
    await expect(walletPage
      .locator('fieldset:has(legend:text("WalletConnect Sessions"))').getByText('No sessions currently active.'))
      .toBeVisible({ timeout: 15_000 })
  })
})
