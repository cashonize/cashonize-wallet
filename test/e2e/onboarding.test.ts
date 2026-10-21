// Onboarding E2E tests. Mainnet only: nothing is sent and no funds are needed.

import { test, expect, type Page } from '@playwright/test'
import {
  deriveHdPath,
  deriveHdPrivateNodeFromBip39Mnemonic,
  deriveHdPublicNode,
  encodeBip39Mnemonic,
  encodeCashAddress,
  generateRandomBytes,
  hash160,
} from '@bitauth/libauth'
import { CASHONIZE_URL, importWalletOnboarding } from './helpers'

// Fresh for every run, so they are unused and an HD wallet shows its first receive address.
// A failing test attaches them to the report; set these variables to rerun with the same ones.
const MNEMONIC_12 = process.env.E2E_ONBOARDING_SEED_12 ?? freshSeedPhrase(16)
const MNEMONIC_24 = process.env.E2E_ONBOARDING_SEED_24 ?? freshSeedPhrase(32)

function freshSeedPhrase(entropyBytes: number) {
  const result = encodeBip39Mnemonic(generateRandomBytes(entropyBytes))
  if (typeof result === 'string') throw new Error(result)
  return result.phrase
}

// The expected addresses come from libauth directly, not from the app's wallet library
function addressesAt(mnemonic: string, path: string) {
  const node = deriveHdPath(deriveHdPrivateNodeFromBip39Mnemonic(mnemonic), path)
  const payload = hash160(deriveHdPublicNode(node).publicKey)
  return {
    address: encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload }).address,
    tokenAddress: encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkhWithTokens', payload }).address,
  }
}

async function expectShownAddresses(page: Page, expected: { address: string, tokenAddress: string }) {
  const shown = page.locator('.depositAddr')
  await expect(shown.first()).toHaveText(expected.address, { timeout: 30_000 })
  await expect(shown.nth(1)).toHaveText(expected.tokenAddress)
}

function preferenceToggle(page: Page, label: string) {
  return page.locator('div:has(> .q-toggle)').filter({ hasText: label }).locator('.q-toggle')
}

test.use({ colorScheme: 'light' })

test.afterEach(async () => {
  const info = test.info()
  if (info.status === info.expectedStatus) return
  await info.attach('seed phrases', {
    contentType: 'text/plain',
    body: `E2E_ONBOARDING_SEED_12="${MNEMONIC_12}"\nE2E_ONBOARDING_SEED_24="${MNEMONIC_24}"\n`,
  })
})

async function shownSeedPhrase(page: Page) {
  await page.locator('nav [aria-label="Settings"]').click()
  await page.getByText('Backup wallet').click()
  await page.getByRole('button', { name: 'Show seed phrase' }).click()
  const words = await page.locator('.seedphrase-word').evaluateAll(spans =>
    spans.map(span => span.lastChild?.textContent?.trim() ?? ''))
  return words.join(' ')
}

test.describe('Onboarding create', () => {
  test('with the defaults: a single address wallet at the standard path of the 12 word seed phrase it shows', async ({ page }) => {
    await page.goto(CASHONIZE_URL)
    await page.getByRole('button', { name: 'Create new wallet' }).click()
    await page.getByRole('button', { name: 'Create wallet' }).click()
    await page.getByRole('button', { name: 'Finish Setup' }).click()

    const seedPhrase = await shownSeedPhrase(page)
    expect(seedPhrase.split(' ')).toHaveLength(12)
    await expect(page.getByText('(BCH standard)')).toBeVisible()
    await page.locator('nav').getByText('Wallet', { exact: true }).click()
    await expectShownAddresses(page, addressesAt(seedPhrase, "m/44'/145'/0'/0/0"))
  })

  test('an HD wallet at the standard path of the seed phrase it shows', async ({ page }) => {
    await page.goto(CASHONIZE_URL)
    await page.getByRole('button', { name: 'Create new wallet' }).click()
    await page.locator('select').filter({ has: page.locator('option[value="hd"]') }).selectOption('hd')
    await page.getByRole('button', { name: 'Create wallet' }).click()
    await page.getByRole('button', { name: 'Finish Setup' }).click()

    const seedPhrase = await shownSeedPhrase(page)
    await page.locator('nav').getByText('Wallet', { exact: true }).click()
    await expectShownAddresses(page, addressesAt(seedPhrase, "m/44'/145'/0'/0/0"))
  })
})

test.describe('Onboarding import', () => {
  // The onboarding defaults decide which addresses a re-imported seed phrase finds, so this test
  // leaves the wallet type and derivation path as they are
  test('12 words with the defaults: a single address wallet at the standard path', async ({ page }) => {
    await importWalletOnboarding(page, { seedPhrase: MNEMONIC_12 })
    await page.getByRole('button', { name: 'Finish Setup' }).click()
    await expectShownAddresses(page, addressesAt(MNEMONIC_12, "m/44'/145'/0'/0/0"))

    // Existing wallets are stored under the default name, so it must not change; a single
    // address wallet stores no type, which reads as single
    const stored = await page.evaluate(() => ({
      activeWalletName: localStorage.getItem('activeWalletName'),
      walletType: JSON.parse(localStorage.getItem('walletMetadata') ?? '{}').mywallet?.walletType,
    }))
    expect(stored).toEqual({ activeWalletName: 'mywallet', walletType: undefined })
  })

  test('24 words, HD wallet at the standard path', async ({ page }) => {
    await importWalletOnboarding(page, { seedPhrase: MNEMONIC_24, pick24Words: true, walletType: 'hd', derivationPath: 'standard' })
    await page.getByRole('button', { name: 'Finish Setup' }).click()
    await expectShownAddresses(page, addressesAt(MNEMONIC_24, "m/44'/145'/0'/0/0"))
  })

  test('12 words, HD wallet at the Bitcoin.com path', async ({ page }) => {
    await importWalletOnboarding(page, { seedPhrase: MNEMONIC_12, walletType: 'hd', derivationPath: 'bitcoindotcom' })
    await page.getByRole('button', { name: 'Finish Setup' }).click()
    await expectShownAddresses(page, addressesAt(MNEMONIC_12, "m/44'/0'/0'/0/0"))
  })

  test('24 words, single address wallet at the SLP path', async ({ page }) => {
    await importWalletOnboarding(page, { seedPhrase: MNEMONIC_24, pick24Words: true, walletType: 'single', derivationPath: 'slp' })
    await page.getByRole('button', { name: 'Finish Setup' }).click()
    await expectShownAddresses(page, addressesAt(MNEMONIC_24, "m/44'/245'/0'/0/0"))
  })

  test('pasting 24 words into the 12 word layout switches to 24 and imports that seed phrase', async ({ page }) => {
    await importWalletOnboarding(page, { seedPhrase: MNEMONIC_24, walletType: 'single', derivationPath: 'standard' })
    await page.getByRole('button', { name: 'Finish Setup' }).click()
    await expectShownAddresses(page, addressesAt(MNEMONIC_24, "m/44'/145'/0'/0/0"))
  })

  test('applies the onboarding preferences and keeps them and the wallet after a reload', async ({ page }) => {
    await importWalletOnboarding(page, { seedPhrase: MNEMONIC_12, walletType: 'hd', derivationPath: 'standard', walletName: 'e2e import' })

    await page.locator('#selectCurrency').selectOption('eur')
    // Confirming payments starts on for new users, so clicking turns it off
    await preferenceToggle(page, 'Dark mode').click()
    await preferenceToggle(page, 'Confirm payments').click()
    await page.getByRole('button', { name: 'Finish Setup' }).click()

    const expected = addressesAt(MNEMONIC_12, "m/44'/145'/0'/0/0")
    await expectShownAddresses(page, expected)
    await expect(page.locator('body')).toHaveClass(/dark/)
    const stored = await page.evaluate(() => ({
      currency: localStorage.getItem('currency'),
      darkMode: localStorage.getItem('darkMode'),
      confirmBeforeSending: localStorage.getItem('confirmBeforeSending'),
      activeWalletName: localStorage.getItem('activeWalletName'),
      walletType: JSON.parse(localStorage.getItem('walletMetadata') ?? '{}')['e2e import']?.walletType,
    }))
    expect(stored).toEqual({
      currency: 'eur',
      darkMode: 'true',
      confirmBeforeSending: 'false',
      activeWalletName: 'e2e import',
      walletType: 'hd',
    })

    await page.reload()
    await expectShownAddresses(page, expected)
    await expect(page.locator('body')).toHaveClass(/dark/)
  })
})
