// Shared helpers for the Cashonize E2E suites (walletconnect.test.ts, cashconnect.test.ts).

import { expect, type Page } from '@playwright/test'

export const CASHONIZE_URL = 'http://localhost:9000'
export const DAPP_URL = 'http://localhost:5188'
export const SEED_PHRASE = process.env.E2E_SEED_PHRASE

// Resolve the currently-open Quasar dialog, scoped to the newest visible one, and wait
// until it is shown. Dialogs animate in/out with a scale transition, so a closing dialog
// and a freshly-opened one can briefly coexist in the DOM. A bare '.q-dialog' locator
// resolves the first match — which may be the stale, detaching dialog — so a subsequent
// click races its removal ("element was detached from the DOM, retrying"). Scoping to
// ':visible' + last() targets the new dialog; the caller's click auto-waits for stability.
export async function waitForDialog(page: Page, timeout = 15_000) {
  const dialog = page.locator('.q-dialog:visible').last()
  await dialog.waitFor({ state: 'visible', timeout })
  return dialog
}

// Run the wallet onboarding (importing E2E_SEED_PHRASE when set, creating a fresh wallet
// otherwise) and switch the wallet to chipnet. Leaves the wallet on the Wallet tab.
export async function setupWalletOnChipnet(walletPage: Page) {
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
  // Wait for network switch to complete. It resets the active view back to the wallet tab.
  await expect(walletPage.locator('nav').getByText('Wallet', { exact: true })).toHaveClass(/active/, { timeout: 15_000 })
}
