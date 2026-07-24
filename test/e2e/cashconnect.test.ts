// CashConnect (Nostr transport) E2E tests for Cashonize Wallet.
// If a seed phrase is provided in the E2E_SEED_PHRASE environment variable or top level .env file,
// the test will import that wallet. Otherwise a new wallet will be created; the transaction
// (approval-dialog) tests require a funded chipnet wallet and are skipped without a seed phrase.
//
// Both sides talk over the library's default public Nostr relay: Cashonize passes no relayUrl to
// its CashConnect Wallet, and Wallet.pair() rejects invites whose relay differs from its own, so
// the test dapp must simply use the same default (it omits relayUrl too).

import { test, expect, type Page } from '@playwright/test'
import { DAPP_URL, SEED_PHRASE, waitForDialog, setupWalletOnChipnet } from './helpers'

let walletPage: Page
let dappPage: Page
// The wallet's own deposit address — the send tests pay back to the wallet itself so
// no funds leave the test wallet even if a transaction is broadcast later.
let walletAddress: string

// Paste the current invite URI from the dapp into the wallet's URI input and click Connect.
async function pairFromDapp() {
  await expect(dappPage.locator('#cc-pairing-uri')).toContainText('bch-cc-v1:', { timeout: 15_000 })
  const uri = await dappPage.textContent('#cc-pairing-uri')

  await walletPage.getByPlaceholder('Wallet Connect URI').fill(uri!)
  await walletPage.locator('input.primaryButton[value*="Connect"]').click()
}

test.describe.serial('CashConnect E2E', () => {
  test.beforeAll(async ({ browser }) => {
    const walletContext = await browser.newContext()
    const dappContext = await browser.newContext()
    walletPage = await walletContext.newPage()
    dappPage = await dappContext.newPage()

    // Set up wallet via onboarding and switch to chipnet
    await setupWalletOnChipnet(walletPage)

    // Read the wallet's deposit address from the wallet tab (used as send recipient)
    walletAddress = (await walletPage.locator('.depositAddr').first().textContent() ?? '').trim()
    expect(walletAddress).toContain('bchtest:')

    // Navigate to WalletConnect tab (hosts the shared URI input and the CashConnect sessions list)
    await walletPage.locator('nav').getByText('WalletConnect').click()
    await walletPage.getByText('Connect to Dapp').waitFor({ timeout: 15_000 })

    // Open test dApp
    await dappPage.goto(DAPP_URL)
    await dappPage.locator('#cc-btn-connect:not([disabled])').waitFor({ timeout: 15_000 })
  })

  test.afterAll(async () => {
    await walletPage?.context().close()
    await dappPage?.context().close()
  })

  test('network mismatch — no session proposal shown', async () => {
    // dApp: request a mainnet session while the wallet is on chipnet
    await dappPage.check('#cc-radio-mainnet')
    await dappPage.click('#cc-btn-connect')
    await pairFromDapp()

    // Wallet: rejects the proposal before any dialog — pair() rethrows the mismatch
    // error and the sessions component surfaces it as an error notification.
    await expect(walletPage.locator('.q-notification').getByText(/requires wallet to be on Mainnet/))
      .toBeVisible({ timeout: 15_000 })
    await expect(walletPage.locator('.q-dialog:visible')).toHaveCount(0)

    // dApp: pairing is left pending — a rejected proposal is not signalled to the dapp
    await expect(dappPage.locator('#cc-session-status')).toHaveText('pairing')

    // Reset for the next test
    await dappPage.check('#cc-radio-chipnet')
  })

  test('connect', async () => {
    // dApp: Connect on chipnet (abandons the mismatched pairing attempt)
    await dappPage.click('#cc-btn-connect')
    await pairFromDapp()

    // Wallet: Approve session proposal (shows dapp metadata and template name)
    const proposalDialog = await waitForDialog(walletPage)
    await expect(proposalDialog).toContainText('BCH CC Test dApp')
    await expect(proposalDialog).toContainText('Cashonize E2E Test Template')
    await proposalDialog.getByRole('button', { name: 'Approve' }).click()

    // dApp: Assert connected
    await expect(dappPage.locator('#cc-session-status')).toHaveText('connected', { timeout: 20_000 })

    // Wallet: Session appears in the CashConnect sessions list
    await expect(walletPage
      .locator('fieldset:has(legend:has-text("CashConnect"))').getByText('BCH CC Test dApp'))
      .toBeVisible({ timeout: 15_000 })
  })

  test('executeAction — resolve action auto-responds without a dialog', async () => {
    await dappPage.click('#cc-btn-ping')

    // Resolve-only actions don't require approval, so no dialog opens in the wallet
    await expect(dappPage.locator('#cc-response')).toContainText('echoed', { timeout: 15_000 })
    await expect(dappPage.locator('#cc-response')).not.toContainText('error')
    await expect(walletPage.locator('.q-dialog:visible')).toHaveCount(0)
  })

  test('getBalances and getTokens auto-respond', async () => {
    await dappPage.click('#cc-btn-get-balances')
    await expect(dappPage.locator('#cc-response')).toContainText('balances', { timeout: 15_000 })
    await expect(dappPage.locator('#cc-response')).not.toContainText('error')

    await dappPage.click('#cc-btn-get-tokens')
    await expect(dappPage.locator('#cc-response')).toContainText('tokens', { timeout: 15_000 })
    await expect(dappPage.locator('#cc-response')).not.toContainText('error')
  })

  test('executeAction — transaction, approve', async () => {
    test.skip(!SEED_PHRASE, 'requires a funded chipnet wallet (E2E_SEED_PHRASE)')

    // dApp: Execute the send action, paying 1000 sats back to the wallet itself
    await dappPage.fill('#cc-input-address', walletAddress)
    await dappPage.click('#cc-btn-send')

    // Wallet: Approval dialog renders the action's meta segments
    const txDialog = await waitForDialog(walletPage, 30_000)
    await expect(txDialog).toContainText('Send')
    await expect(txDialog).toContainText('Balance Change')
    await txDialog.getByRole('button', { name: 'Approve' }).click()

    // dApp: Response contains the signed transaction(s). The dapp is responsible for
    // broadcasting in CashConnect; the test does not broadcast, keeping UTXOs stable.
    await expect(dappPage.locator('#cc-response')).toContainText('txHash', { timeout: 15_000 })
    await expect(dappPage.locator('#cc-response')).toContainText('transactions')

    // Wallet: Success notification
    await expect(walletPage.locator('.q-notification').getByText('Successfully signed transaction'))
      .toBeVisible({ timeout: 5_000 })
  })

  test('executeAction — transaction, reject', async () => {
    test.skip(!SEED_PHRASE, 'requires a funded chipnet wallet (E2E_SEED_PHRASE)')

    await dappPage.fill('#cc-input-address', walletAddress)
    await dappPage.click('#cc-btn-send')

    // Wallet: Reject in the approval dialog
    const txDialog = await waitForDialog(walletPage, 30_000)
    await txDialog.getByRole('button', { name: 'Reject' }).click()

    // dApp: Receives the wallet's rejection
    await expect(dappPage.locator('#cc-response')).toContainText('error', { timeout: 15_000 })
  })

  test('executeAction — transaction, cancelled from the dapp', async () => {
    test.skip(!SEED_PHRASE, 'requires a funded chipnet wallet (E2E_SEED_PHRASE)')

    await dappPage.fill('#cc-input-address', walletAddress)
    await dappPage.click('#cc-btn-send')

    // Wallet: Wait for the approval dialog
    const txDialog = await waitForDialog(walletPage, 30_000)

    // dApp: Abort the request — the cancellation notification travels over Nostr
    await dappPage.click('#cc-btn-cancel')

    // Wallet: Dialog is dismissed by the request's abort signal
    await expect(txDialog).not.toBeVisible({ timeout: 15_000 })

    // dApp: Sees its own cancellation
    await expect(dappPage.locator('#cc-response')).toContainText('cancelled', { timeout: 15_000 })
  })

  test('disconnect', async () => {
    await dappPage.click('#cc-btn-disconnect')

    // dApp: Assert disconnected
    await expect(dappPage.locator('#cc-session-status')).toHaveText('disconnected', { timeout: 15_000 })

    // Wallet: Assert no active CashConnect sessions
    await expect(walletPage
      .locator('fieldset:has(legend:has-text("CashConnect"))').getByText('No sessions currently active.'))
      .toBeVisible({ timeout: 15_000 })
  })
})
