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
  // A 24 word phrase cut to the 12 word layout would import a different wallet, or none
  if (options.seedPhrase.split(' ').length === 24) await expect(page.getByLabel('24 words')).toBeChecked()

  if (options.walletType) {
    await page.locator('select').filter({ has: page.locator('option[value="hd"]') }).selectOption(options.walletType)
  }
  if (options.derivationPath) {
    await page.locator('select').filter({ has: page.locator('option[value="bitcoindotcom"]') }).selectOption(options.derivationPath)
  }
  await page.getByRole('button', { name: 'Import wallet' }).click()
  await page.getByRole('button', { name: 'Finish Setup' }).waitFor({ timeout: 15_000 })
}

// A wallet lives on one network, and onboarding makes mainnet ones: a chipnet wallet is added from
// the developer settings, which open it once it is made. Creates one, or imports the seed phrase.
export async function addChipnetWallet(page: Page, options: { seedPhrase?: string, walletType?: 'single' | 'hd', walletName?: string } = {}) {
  await page.locator('nav img[src*="settings"]').click()
  await page.getByText('Developer settings').click()
  await page.getByText('Add development wallet').click()
  await expect(page.locator('#addWalletNetwork')).toHaveValue('chipnet')
  if (options.walletName) await page.getByPlaceholder('Enter wallet name').fill(options.walletName)
  await page.getByRole('button', { name: 'Continue' }).click()
  if (options.walletType) {
    await page.locator('select').filter({ has: page.locator('option[value="hd"]') }).selectOption(options.walletType)
  }
  if (options.seedPhrase) {
    await page.getByRole('button', { name: 'Import existing wallet' }).click()
    const firstSeedInput = page.locator('.seed-words-grid input').first()
    await firstSeedInput.fill(options.seedPhrase)
    await firstSeedInput.dispatchEvent('input')
    await page.getByRole('button', { name: 'Import', exact: true }).click()
  } else {
    await page.getByRole('button', { name: 'Create new wallet' }).click()
  }
  if (options.walletName) await expect(page.locator('legend.walletName')).toContainText(options.walletName, { timeout: 30_000 })
  await expect(page.locator('.depositAddr').first()).toHaveText(/^bchtest:/, { timeout: 30_000 })
}

// Runs the onboarding, then adds a chipnet wallet: importing E2E_SEED_PHRASE when set, creating a
// fresh one otherwise. Leaves the chipnet wallet on the Wallet tab.
export async function setupWalletOnChipnet(walletPage: Page) {
  await walletPage.goto(CASHONIZE_URL)
  await walletPage.getByRole('button', { name: 'Create new wallet' }).click()
  await walletPage.getByRole('button', { name: 'Create wallet' }).click()
  await walletPage.getByRole('button', { name: 'Finish Setup' }).click()
  await walletPage.locator('nav').waitFor({ timeout: 15_000 })
  await addChipnetWallet(walletPage, SEED_PHRASE ? { seedPhrase: SEED_PHRASE } : {})
}
