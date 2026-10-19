// Shared helpers for the Cashonize E2E suites.

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

export interface ImportOptions {
  seedPhrase: string
  walletType?: 'single' | 'hd'
  derivationPath?: 'standard' | 'bitcoindotcom' | 'slp'
  walletName?: string
  // Pick the 24 word layout before pasting, as a user may; a paste switches to it as well
  pick24Words?: boolean
}

// Run the onboarding import up to the preferences step. Wallet type and derivation path stay
// at the onboarding defaults (single address, standard path) unless given.
export async function importWalletOnboarding(page: Page, options: ImportOptions) {
  await page.goto(CASHONIZE_URL)
  await page.getByRole('button', { name: 'Import wallet' }).click()

  if (options.walletName) await page.locator('#walletNameImport').fill(options.walletName)
  if (options.pick24Words) await page.getByLabel('24 words').check()

  // Paste the seed phrase into the first field — onWordInput distributes the words
  const firstSeedInput = page.locator('.seed-words-grid input').first()
  await firstSeedInput.fill(options.seedPhrase)
  await firstSeedInput.dispatchEvent('input')

  if (options.walletType) {
    await page.locator('select').filter({ has: page.locator('option[value="hd"]') }).selectOption(options.walletType)
  }
  if (options.derivationPath) {
    await page.locator('select').filter({ has: page.locator('option[value="bitcoindotcom"]') }).selectOption(options.derivationPath)
  }
  await page.getByRole('button', { name: 'Import wallet' }).click()
  await page.getByRole('button', { name: 'Finish Setup' }).waitFor({ timeout: 15_000 })
}

// Run the wallet onboarding (importing E2E_SEED_PHRASE when set, creating a fresh wallet
// otherwise) and switch the wallet to chipnet. Leaves the wallet on the Wallet tab.
export async function setupWalletOnChipnet(walletPage: Page) {
  if (SEED_PHRASE) {
    // Import funded wallet
    await importWalletOnboarding(walletPage, { seedPhrase: SEED_PHRASE })
  } else {
    // Create a new wallet (no funds)
    await walletPage.goto(CASHONIZE_URL)
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
