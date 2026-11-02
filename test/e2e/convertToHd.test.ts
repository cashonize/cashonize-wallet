// Converting a single address wallet into an HD wallet, and the way WizardConnect leads there.
// Mainnet only: nothing is sent and no funds are needed.

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
import { importWalletOnboarding } from './helpers'

// Fresh for every run, so it is unused and the HD wallet shows its first receive address
const MNEMONIC = process.env.E2E_CONVERT_SEED ?? freshSeedPhrase()

function freshSeedPhrase() {
  const result = encodeBip39Mnemonic(generateRandomBytes(16))
  if (typeof result === 'string') throw new Error(result)
  return result.phrase
}

// From libauth directly: the single address, which is also the HD wallet's first receive address
function firstAddress(mnemonic: string) {
  const node = deriveHdPath(deriveHdPrivateNodeFromBip39Mnemonic(mnemonic), "m/44'/145'/0'/0/0")
  const payload = hash160(deriveHdPublicNode(node).publicKey)
  return encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload }).address
}

test.use({ colorScheme: 'light' })

test.afterEach(async () => {
  const info = test.info()
  if (info.status === info.expectedStatus) return
  await info.attach('seed phrase', { contentType: 'text/plain', body: `E2E_CONVERT_SEED="${MNEMONIC}"\n` })
})

// onboarding imports as a single address wallet by default
async function openSingleAddressWallet(page: Page) {
  await importWalletOnboarding(page, { seedPhrase: MNEMONIC })
  await page.getByRole('button', { name: 'Finish Setup' }).click()
  await expect(page.locator('.depositAddr').first()).toHaveText(firstAddress(MNEMONIC), { timeout: 30_000 })
}

async function openManageWallets(page: Page) {
  await page.locator('nav img[src*="settings"]').click()
  await page.getByText('Manage wallets').click()
}

test('converts the single address wallet into the HD wallet on the same seed, keeping its address', async ({ page }) => {
  await openSingleAddressWallet(page)
  await openManageWallets(page)

  await page.getByRole('button', { name: 'Convert to HD wallet' }).click()
  const dialog = page.locator('.q-dialog')
  await expect(dialog).toContainText('Convert to HD wallet?')
  await dialog.getByRole('button', { name: 'Convert', exact: true }).click()
  await expect(page.locator('.q-notification')).toContainText('is now an HD wallet')

  // offered only to single address wallets
  await expect(page.getByRole('button', { name: 'Convert to HD wallet' })).toHaveCount(0)
  await page.locator('nav').getByText('Wallet', { exact: true }).click()
  await expect(page.locator('.depositAddr').first()).toHaveText(firstAddress(MNEMONIC), { timeout: 30_000 })

  // stored as HD: still HD, and still the same address, after a reload
  await page.reload()
  await expect(page.locator('.depositAddr').first()).toHaveText(firstAddress(MNEMONIC), { timeout: 30_000 })
  await openManageWallets(page)
  await expect(page.getByRole('button', { name: 'Convert to HD wallet' })).toHaveCount(0)
})

test('a WizardConnect link on a single address wallet leads to Manage wallets, and keeps the link', async ({ page }) => {
  await openSingleAddressWallet(page)
  const wizUri = 'WIZ://%3FP%3DCPEU6R237MYMCYW3LG5N49FG68C2KVT254PLLGRFLAVRPCVPRJSS%26S%3DUAP4YCQSW0RA2'

  await page.locator('nav').getByText('Connect', { exact: true }).click()
  await page.getByPlaceholder('Connection URI').fill(wizUri)
  await page.locator('input.primaryButton[value*="Connect"]').click()

  const dialog = page.locator('.q-dialog')
  await expect(dialog).toContainText('WizardConnect needs an HD wallet')
  await dialog.getByRole('button', { name: 'Go to Manage wallets' }).click()
  // nothing was converted from the connect action
  await expect(page.getByRole('button', { name: 'Convert to HD wallet' })).toBeVisible()

  await page.locator('nav').getByText('Connect', { exact: true }).click()
  await expect(page.getByPlaceholder('Connection URI')).toHaveValue(wizUri)
})
