// Wallet flows that broke and were fixed, each a test of the right behavior. How the library builds
// transactions (coin selection, change, fees, token conservation) is tested in the library.

import { expect, test } from '@playwright/test'
import { SECOND_ELECTRUM_SERVER, createToken, fund, randomAddress, rpc } from './chain'
import { dropNextBroadcast, proxyStats } from './proxy'
import { addWallet, broadcastTxid, depositAddress, errorNotification, expectBalance, openRegtestWallet, switchChipnetServer, tokenDepositAddress } from './app'

test.use({ colorScheme: 'light' })

// mainnet-js returns from a send before an HD wallet's coins show it, so the next send of a
// sequence can pick a coin the last one spent, and the server refuses it (#372)
test('transfer all moves every asset of an HD wallet in its consecutive sends', async ({ page }) => {
  await openRegtestWallet(page, { walletType: 'hd' })
  await fund(await depositAddress(page), 200_000n)
  for (let i = 0; i < 3; i++) await createToken(await tokenDepositAddress(page), { amount: 100n })
  await expectBalance(page, '0.002')

  await page.locator('nav [aria-label="Settings"]').click()
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

// A server change made a new connection and never closed the one it replaced, so the deselected
// server kept the app's connection and its header subscription (#375)
test('a server change leaves no connection open on the server it replaced', async ({ page }) => {
  await openRegtestWallet(page)
  await fund(await depositAddress(page), 100_000n)
  await expectBalance(page, '0.001')
  await expect.poll(async () => (await proxyStats()).a.connections).toBeGreaterThan(0)

  await switchChipnetServer(page, SECOND_ELECTRUM_SERVER)
  await expectBalance(page, '0.001')
  await expect.poll(async () => (await proxyStats()).b.connections).toBeGreaterThan(0)

  await expect.poll(async () => (await proxyStats()).a.connections, { timeout: 15_000 }).toBe(0)
})

// After a server change, the next wallet of a network already connected was made on the old
// server, which saw its addresses before the wallet moved to the selected one: an HD wallet starts
// its address discovery as it is made, on the library's global provider of the network (#375)
test('an HD wallet opened after a server change asks the old server about none of its addresses', async ({ page }) => {
  await openRegtestWallet(page, { walletType: 'hd' })
  await switchChipnetServer(page, SECOND_ELECTRUM_SERVER)

  await addWallet(page, 'second', 'hd')
  const address = await depositAddress(page)
  const askedAbout = async () => {
    const { a, b } = await proxyStats()
    return [...a.addresses, ...b.addresses].includes(address)
  }
  await expect.poll(askedAbout).toBe(true)

  const askedOldServer = (await proxyStats()).a.addresses.includes(address)
  expect(askedOldServer, 'the server replaced before the wallet was made was asked about it').toBe(false)
})
