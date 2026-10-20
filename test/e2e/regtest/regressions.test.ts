// Wallet flows that broke on mainnet-js and work on bch-wallet-lib (#371). How the library builds
// transactions (coin selection, change, fees, token conservation) is tested in the library.

import { expect, test } from '@playwright/test'
import { createToken, fund, randomAddress, rpc } from './chain'
import { dropNextBroadcast } from './proxy'
import { broadcastTxid, depositAddress, errorNotification, expectBalance, openRegtestWallet, tokenDepositAddress } from './app'

test.use({ colorScheme: 'light' })

// mainnet-js returns from a send before an HD wallet's coins show it, so the next send of a
// sequence can pick a coin the last one spent, and the server refuses it (#372)
test('transfer all moves every asset of an HD wallet in its consecutive sends', async ({ page }) => {
  await openRegtestWallet(page, { walletType: 'hd' })
  await fund(await depositAddress(page), 200_000n)
  for (let i = 0; i < 3; i++) await createToken(await tokenDepositAddress(page), { amount: 100n })
  await expectBalance(page, '0.002')

  await page.locator('nav img[src*="settings"]').click()
  await page.getByText('Wallet tools').click()
  await page.getByText('Transfer All Assets').first().click()
  await page.getByPlaceholder('Token address to transfer everything to').fill(randomAddress('p2pkhWithTokens'))
  await page.locator('input.primaryButton[value="Transfer All Assets"]').click()
  await page.locator('.q-dialog:visible').getByRole('button', { name: 'Transfer' }).click()

  const success = page.getByText('Successfully transferred all assets')
  await expect(success.or(errorNotification(page)).first()).toBeVisible({ timeout: 90_000 })
  await expect(errorNotification(page)).toHaveCount(0)
  await expect(success).toBeVisible()
})

// A broadcast whose connection drops after it left may have reached the node all the same. The
// app on mainnet-js shows electrum-cash's raw "Connection lost" for a transaction that went out,
// after which a send from the form pays twice; it should find out it went through (#371)
test('a send whose connection dropped after the broadcast left is reported sent', async ({ page }) => {
  await openRegtestWallet(page)
  await fund(await depositAddress(page), 100_000n)
  await expectBalance(page, '0.001')

  await dropNextBroadcast()
  await page.locator('input[name="addressInput"]').fill(randomAddress())
  await page.locator('input[name="currencyInput"]').fill('0.0004')
  await page.locator('input.primaryButton[type="button"]').click()
  await page.locator('.q-dialog:visible').getByRole('button', { name: 'Confirm' }).click()

  // the node has it
  await expect.poll(async () => (await rpc<string[]>('getrawmempool')).length, { timeout: 30_000 }).toBe(1)
  const [inMempool] = await rpc<string[]>('getrawmempool')
  expect(await broadcastTxid(page)).toBe(inMempool)
})
