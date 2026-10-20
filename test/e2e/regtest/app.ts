// The app's side of the regtest e2e tests: a wallet in chipnet mode whose electrum server is the
// proxy in front of the regtest Fulcrum.

import { expect, type Page } from '@playwright/test'
import { CASHONIZE_URL, importWalletOnboarding, type ImportOptions } from '../helpers'
import { APP_ELECTRUM_SERVER } from './chain'

// The app's chipnet server is the regtest one from the first load on
async function pointAppAtRegtest(page: Page) {
  await page.addInitScript(server => {
    localStorage.setItem('electrum-chipnet', server)
  }, APP_ELECTRUM_SERVER)
}

export interface WalletOptions {
  walletType?: 'single' | 'hd'
  // imports this seed phrase instead of creating a wallet
  seedPhrase?: string
}

// Creates (or imports) a wallet and leaves it on the Wallet tab, connected to the regtest chain
export async function openRegtestWallet(page: Page, options: WalletOptions = {}) {
  await pointAppAtRegtest(page)
  if (options.seedPhrase) {
    const importOptions: ImportOptions = { seedPhrase: options.seedPhrase }
    if (options.walletType) importOptions.walletType = options.walletType
    await importWalletOnboarding(page, importOptions)
  } else {
    await page.goto(CASHONIZE_URL)
    await page.getByRole('button', { name: 'Create new wallet' }).click()
    if (options.walletType) {
      await page.locator('select').filter({ has: page.locator('option[value="hd"]') }).selectOption(options.walletType)
    }
    await page.getByRole('button', { name: 'Create wallet' }).click()
  }
  await page.getByRole('button', { name: 'Finish Setup' }).click()
  await page.locator('nav').waitFor({ timeout: 15_000 })

  // onboarding opens the wallet on mainnet; the developer settings switch it to chipnet
  await page.locator('nav img[src*="settings"]').click()
  await page.getByText('Developer settings').click()
  await page.locator('select').first().selectOption('chipnet')
  await expect(page.locator('.depositAddr').first()).toHaveText(/^bchtest:/, { timeout: 30_000 })
}

export async function depositAddress(page: Page): Promise<string> {
  return (await page.locator('.depositAddr').first().innerText()).trim()
}

export async function tokenDepositAddress(page: Page): Promise<string> {
  return (await page.locator('.depositAddr').nth(1).innerText()).trim()
}

// The wallet's balance line in tBCH, e.g. "0.001 tBCH"
export async function expectBalance(page: Page, tbch: string) {
  await expect(page.getByText(`${tbch} tBCH`, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
}

// Confirms a payment when the app asks for it (the "Confirm payments" setting), or else goes on once
// the broadcast has an outcome
export async function confirmIfAsked(page: Page) {
  const confirm = page.locator('.q-dialog:visible').getByRole('button', { name: 'Confirm' })
  const outcome = page.getByText('Transaction successfully sent!').or(errorNotification(page))
  await expect(confirm.or(outcome).first()).toBeVisible({ timeout: 60_000 })
  if (await confirm.isVisible()) await confirm.click()
}

// A notification in red: the app's way of showing an error
export function errorNotification(page: Page) {
  return page.locator('.q-notification.bg-red')
}

// Waits for the success dialog a broadcast opens and returns the txid it shows, closing it; an
// error notification instead fails with its text
export async function broadcastTxid(page: Page): Promise<string> {
  const success = page.getByText('Transaction successfully sent!')
  const failure = errorNotification(page)
  await expect(success.or(failure).first()).toBeVisible({ timeout: 60_000 })
  if (await failure.first().isVisible()) throw new Error(`the app showed an error: ${await failure.first().innerText()}`)
  // the dialog shows the txid shortened; its explorer link has it whole
  const link = page.locator('.q-dialog:visible a[href*="/"]').last()
  const txid = (await link.getAttribute('href'))?.match(/[0-9a-f]{64}/)?.[0]
  if (!txid) throw new Error('no txid in the success dialog')
  await page.keyboard.press('Escape')
  return txid
}

// Sends BCH from the Wallet tab, confirming the payment when the app asks, and returns the txid
export async function sendBch(page: Page, address: string, tbch: string): Promise<string> {
  await page.locator('input[name="addressInput"]').fill(address)
  await page.locator('input[name="currencyInput"]').fill(tbch)
  await page.locator('input.primaryButton[type="button"]').click()
  await confirmIfAsked(page)
  return broadcastTxid(page)
}
