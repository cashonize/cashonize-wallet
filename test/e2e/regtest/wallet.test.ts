// The regtest setup works end to end: the app in chipnet mode receives and sends on the local chain.

import { expect, test } from '@playwright/test'
import { decodedTransaction, fund, mine, randomAddress, toRegtest } from './chain'
import { depositAddress, expectBalance, openRegtestWallet, sendBch } from './app'

test.use({ colorScheme: 'light' })

test('shows a payment it received', async ({ page }) => {
  await openRegtestWallet(page)
  await fund(await depositAddress(page), 100_000n)
  await expectBalance(page, '0.001')
})

test('sends BCH, and the payment confirms', async ({ page }) => {
  await openRegtestWallet(page)
  await fund(await depositAddress(page), 100_000n)
  await expectBalance(page, '0.001')

  const destination = randomAddress()
  const txid = await sendBch(page, destination, '0.0004')
  await mine()
  const transaction = await decodedTransaction(txid)
  const paid = transaction.vout.find(output => output.scriptPubKey.addresses?.includes(toRegtest(destination)))
  expect(paid?.value).toBe(0.0004)
})

// A wallet made in the app can hold funds without its seed phrase ever having been shown
test('asks for a backup once the wallet holds funds, until told to remind later', async ({ page }) => {
  await openRegtestWallet(page)
  const reminder = page.getByText('This wallet is not backed up')
  await expectBalance(page, '0')
  await expect(reminder).toBeHidden()

  await fund(await depositAddress(page), 100_000n)
  await expectBalance(page, '0.001')
  await expect(reminder).toBeVisible()

  await page.getByRole('button', { name: 'Remind me later' }).click()
  await expect(reminder).toBeHidden()
  // the choice is the wallet's, kept across a reload
  await page.reload()
  await expectBalance(page, '0.001')
  await expect(reminder).toBeHidden()
})
