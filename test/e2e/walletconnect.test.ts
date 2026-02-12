// WalletConnect E2E tests for Cashonize Wallet.
// If a seed phrase is provided in the E2E_SEED_PHRASE environment variable or top level .env file,
// the test will import a funded chipnet wallet and test all methods. Otherwise,
// a new wallet will be created with a zero balance and the signTransaction method will be skipped.

import { test, expect, type Page } from '@playwright/test'

const CASHONIZE_URL = 'http://localhost:9000'
const DAPP_URL = 'http://localhost:5188'
const SEED_PHRASE = process.env.E2E_SEED_PHRASE
const hasFunds = !!SEED_PHRASE

let walletPage: Page
let dappPage: Page

test.describe.serial('WalletConnect E2E', () => {
  test.beforeAll(async ({ browser }) => {
    const walletContext = await browser.newContext()
    const dappContext = await browser.newContext()
    walletPage = await walletContext.newPage()
    dappPage = await dappContext.newPage()

    // Set up wallet via onboarding
    await walletPage.goto(CASHONIZE_URL)

    if (SEED_PHRASE) {
      // Import funded wallet
      await walletPage.getByRole('button', { name: 'Import wallet' }).click()

      // Paste seed phrase — onWordInput distributes words across all 12 fields
      const firstSeedInput = walletPage.locator('.seed-words-grid input').first()
      await firstSeedInput.fill(SEED_PHRASE)
      await firstSeedInput.dispatchEvent('input')

      await walletPage.getByRole('button', { name: 'Import wallet' }).click()
    } else {
      // Create a new wallet (no funds)
      await walletPage.getByRole('button', { name: 'Create new wallet' }).click()
      await walletPage.getByRole('button', { name: 'Create wallet' }).click()
    }

    // Finish onboarding — wait for nav tabs to appear (wallet loaded)
    await walletPage.getByRole('button', { name: 'Finish Setup' }).click()
    await walletPage.locator('nav').waitFor({ timeout: 15_000 })

    // Switch to chipnet: Settings → Developer settings → change network
    await walletPage.locator('nav img[src*="settings"]').click()
    await walletPage.getByText('Developer settings').click()
    await walletPage.locator('select').first().selectOption('chipnet')
    // Wait for network switch to complete — nav reappears after reload
    await walletPage.locator('nav').waitFor({ timeout: 15_000 })

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
    const signDialog = walletPage.locator('.q-dialog')
    await signDialog.waitFor({ timeout: 15_000 })
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
    const signDialog = walletPage.locator('.q-dialog')
    await signDialog.waitFor({ timeout: 15_000 })
    await signDialog.getByRole('button', { name: 'Cancel' }).click()

    // dApp: Assert error response
    await expect(dappPage.locator('#response')).toContainText('error', { timeout: 15_000 })
  })

  test('signTransaction', async () => {
    test.skip(!hasFunds, 'Requires E2E_SEED_PHRASE with funded chipnet wallet')

    await dappPage.click('#btn-sign-transaction')

    // Wallet: Wait for transaction dialog, click Sign
    const txDialog = walletPage.locator('.q-dialog')
    await txDialog.waitFor({ timeout: 15_000 })
    await txDialog.getByRole('button', { name: 'Sign' }).click()

    // dApp: Assert response contains signed transaction
    await expect(dappPage.locator('#response')).toContainText('signedTransaction', { timeout: 15_000 })
    await expect(dappPage.locator('#response')).toContainText('signedTransactionHash')
  })

  test('cancelPendingRequests', async () => {
    test.skip(!hasFunds, 'Requires E2E_SEED_PHRASE with funded chipnet wallet')

    // dApp: Start a sign transaction request (opens dialog in wallet)
    await dappPage.click('#btn-sign-transaction')

    // Wallet: Wait for transaction dialog to appear
    const txDialog = walletPage.locator('.q-dialog')
    await txDialog.waitFor({ timeout: 15_000 })

    // dApp: Send cancel request
    await dappPage.click('#btn-cancel-pending')

    // Wallet: Dialog should be dismissed
    await expect(txDialog).not.toBeVisible({ timeout: 15_000 })

    // dApp: Cancel response should contain cancelledCount
    await expect(dappPage.locator('#response')).toContainText('cancelledCount', { timeout: 15_000 })
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
