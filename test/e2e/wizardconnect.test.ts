// WizardConnect E2E tests for Cashonize Wallet.
// Creates a fresh HD wallet via onboarding (WizardConnect requires an HD wallet) and drives
// a WizardConnect test dapp (the wizardconnect section of test-dapp) through the live Nostr
// relay (wss://relay.riften.net), matching the wizardconnect library's own integration tests.
// The sign tests use a fake UTXO with broadcast: false, so no funds are needed.

import { test, expect, type Page } from '@playwright/test'

const CASHONIZE_URL = 'http://localhost:9000'
const DAPP_URL = 'http://localhost:5188'

// Live-relay round trips (gift-wrap publish + delivery) can take a few seconds
const RELAY_TIMEOUT = 30_000

let walletPage: Page
let dappPage: Page

// Resolve the currently-open Quasar dialog, scoped to the newest visible one, and wait
// until it is shown (see walletconnect.test.ts for the rationale).
async function waitForDialog(page: Page, timeout = 15_000) {
  const dialog = page.locator('.q-dialog:visible').last()
  await dialog.waitFor({ state: 'visible', timeout })
  return dialog
}

// The unified dApp sessions box on the wallet's connect view (all three
// connection methods render their sessions as sections inside it)
function wizSection(page: Page) {
  return page.locator('fieldset:has(legend:text("dApp Sessions"))')
}

// Track the previous pairing URI so a re-pair never reads the stale one off the page
let lastPairingUri = ''

// dApp: start a fresh pairing; wallet: paste the URI and wait for the consent dialog
async function startPairing() {
  await dappPage.click('#wiz-btn-connect')
  const uriLocator = dappPage.locator('#wiz-pairing-uri')
  await expect(uriLocator).toContainText('wiz://', { timeout: 15_000 })
  if (lastPairingUri) await expect(uriLocator).not.toHaveText(lastPairingUri)
  const uri = (await uriLocator.textContent())!.trim()
  lastPairingUri = uri

  // Wait for any previous pairing flow to release the URI input: connectDappUriInput clears
  // it only after its (consent-dialog-gated) promise resolves, so filling too early races
  // that late clear and the Connect click would submit an empty input.
  const uriInput = walletPage.getByPlaceholder('Connection URI')
  await expect(uriInput).toHaveValue('')
  await uriInput.fill(uri)
  await walletPage.locator('input.primaryButton[value*="Connect"]').click()

  // Wallet: xpub-sharing consent dialog
  return waitForDialog(walletPage)
}

// Approve the consent dialog and wait until both sides report the session
async function pairAndApprove() {
  const consentDialog = await startPairing()
  await consentDialog.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(dappPage.locator('#wiz-session-status')).toHaveText('connected', { timeout: RELAY_TIMEOUT })
  await expect(wizSection(walletPage).getByText('Wiz Test dApp')).toBeVisible({ timeout: RELAY_TIMEOUT })
}

test.describe.serial('WizardConnect E2E', () => {
  test.beforeAll(async ({ browser }) => {
    const walletContext = await browser.newContext()
    const dappContext = await browser.newContext()
    walletPage = await walletContext.newPage()
    dappPage = await dappContext.newPage()

    // NOTE: unlike the WalletConnect suite, no fake clocks are installed here — the Nostr
    // transport's keepalive pings and the protocol's `time`-based replay filtering rely on
    // real time and would misbehave under a frozen clock.

    // Set up a fresh HD wallet via onboarding (WizardConnect requires an HD wallet)
    await walletPage.goto(CASHONIZE_URL)
    await walletPage.getByRole('button', { name: 'Create new wallet' }).click()
    await walletPage.locator('select').first().selectOption('hd')
    await walletPage.getByRole('button', { name: 'Create wallet' }).click()

    // Finish onboarding — wait for nav tabs to appear (wallet loaded)
    await walletPage.getByRole('button', { name: 'Finish Setup' }).click()
    await walletPage.locator('nav').waitFor({ timeout: 15_000 })

    // Navigate to the connect view, wait for sessions section
    await walletPage.locator('nav').getByText('WalletConnect').click()
    await walletPage.getByText('Connect to Dapp').waitFor({ timeout: 15_000 })

    // Open test dApp (the WizardConnect manager needs no async init)
    await dappPage.goto(DAPP_URL)
    await dappPage.locator('#wiz-btn-connect').waitFor({ timeout: 15_000 })
  })

  test.afterAll(async () => {
    await walletPage?.context().close()
    await dappPage?.context().close()
  })

  test('rejecting the consent dialog shares nothing and creates no session', async () => {
    const consentDialog = await startPairing()
    // The consent dialog must warn about the xpub / full address list disclosure
    await expect(consentDialog).toContainText('address list')
    await expect(consentDialog).toContainText('xpub')
    await consentDialog.getByRole('button', { name: 'Cancel' }).click()

    // Wallet: no session was created
    await expect(wizSection(walletPage).getByText('No sessions currently active.')).toBeVisible()
    // dApp: still waiting, no wallet_ready (xpubs) received
    await expect(dappPage.locator('#wiz-session-status')).toHaveText('waiting')
    await expect(dappPage.locator('#wiz-response')).not.toContainText('paths')
  })

  test('connect — approving the consent dialog shares the session xpubs', async () => {
    const consentDialog = await startPairing()
    await consentDialog.getByRole('button', { name: 'Connect', exact: true }).click()

    // dApp: session established, wallet identity and the three chain xpubs received
    await expect(dappPage.locator('#wiz-session-status')).toHaveText('connected', { timeout: RELAY_TIMEOUT })
    const response = dappPage.locator('#wiz-response')
    await expect(response).toContainText('Cashonize')
    await expect(response).toContainText('receive')
    await expect(response).toContainText('change')
    await expect(response).toContainText('defi')

    // Wallet: session card shows the dapp name and connected status
    await expect(wizSection(walletPage).getByText('Wiz Test dApp')).toBeVisible({ timeout: RELAY_TIMEOUT })
    await expect(wizSection(walletPage).getByText('Connected')).toBeVisible()
  })

  test('signTransaction — approve (signature VM-verified by the dapp)', async () => {
    await dappPage.click('#wiz-btn-sign-transaction')

    // Wallet: transaction approval dialog shows the dapp's user prompt
    const txDialog = await waitForDialog(walletPage, RELAY_TIMEOUT)
    await expect(txDialog).toContainText('Wiz test transaction')
    await txDialog.getByRole('button', { name: 'Sign' }).click()

    // dApp: response contains the signed transaction and it passes libauth VM verification
    await expect(dappPage.locator('#wiz-response')).toContainText('signedTransaction', { timeout: RELAY_TIMEOUT })
    await expect(dappPage.locator('#wiz-response')).toContainText('"vmVerified":true')

    // Wallet: dismiss the "Transaction Signed" alert dialog
    const alertDialog = walletPage.locator('.alertDialog')
    await alertDialog.waitFor({ timeout: 5_000 })
    await walletPage.keyboard.press('Escape')
    await expect(alertDialog).not.toBeVisible({ timeout: 5_000 })
  })

  test('signTransaction — reject', async () => {
    await dappPage.click('#wiz-btn-sign-transaction')

    const txDialog = await waitForDialog(walletPage, RELAY_TIMEOUT)
    await txDialog.getByRole('button', { name: 'Cancel' }).click()

    // dApp: sign promise rejects with the wallet's error
    await expect(dappPage.locator('#wiz-response')).toContainText('User rejected', { timeout: RELAY_TIMEOUT })
  })

  test('sign_cancel — dapp cancels a pending request and the dialog closes', async () => {
    await dappPage.click('#wiz-btn-sign-transaction')

    const txDialog = await waitForDialog(walletPage, RELAY_TIMEOUT)

    // dApp: cancel the in-flight request (sends sign_cancel over the relay)
    await dappPage.click('#wiz-btn-cancel-sign')

    // Wallet: the approval dialog is dismissed
    await expect(txDialog).not.toBeVisible({ timeout: RELAY_TIMEOUT })
    // dApp: the sign promise was aborted
    await expect(dappPage.locator('#wiz-response')).toContainText('Cancelled by test dApp')
  })

  test('session restore — wallet reload reconnects without re-prompting consent', async () => {
    await walletPage.reload()
    await walletPage.locator('nav').waitFor({ timeout: 30_000 })
    await walletPage.locator('nav').getByText('WalletConnect').click()

    // The persisted session reconnects with the same relay identity; the dapp
    // re-announces itself (dapp_ready) so the session card regains its name.
    // No consent dialog appears for restored sessions.
    await expect(wizSection(walletPage).getByText('Wiz Test dApp')).toBeVisible({ timeout: RELAY_TIMEOUT })
    await expect(walletPage.locator('.q-dialog')).not.toBeVisible()
    await expect(dappPage.locator('#wiz-session-status')).toHaveText('connected')
  })

  test('disconnect — wallet-initiated, courtesy message reaches the dapp', async () => {
    // exercises the patched doDisconnect: the disconnect message must be relayed
    // before the connection is torn down, or the dapp never learns of it
    await wizSection(walletPage).locator('.wiz-session-item-action-icon').click()

    // Wallet: session removed optimistically
    await expect(wizSection(walletPage).getByText('No sessions currently active.')).toBeVisible({ timeout: 15_000 })

    // dApp: receives the disconnect (after its 8s reconnect-grace window)
    await expect(dappPage.locator('#wiz-session-status')).toHaveText('disconnected', { timeout: RELAY_TIMEOUT })
  })

  test('disconnect — dapp-initiated removes the wallet session', async () => {
    // Re-pair first (fresh URI, consent required again for a new pairing)
    await pairAndApprove()

    await dappPage.click('#wiz-btn-disconnect')
    await expect(dappPage.locator('#wiz-session-status')).toHaveText('disconnected')

    // Wallet: remote disconnect removes the session and notifies the user
    await expect(wizSection(walletPage).getByText('No sessions currently active.')).toBeVisible({ timeout: RELAY_TIMEOUT })
  })
})
