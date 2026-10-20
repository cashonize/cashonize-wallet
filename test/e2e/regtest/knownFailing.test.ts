// Known bugs of the app, each a test of the right behavior marked test.fail(): the suite stays
// green while the bug is there, and a test that starts passing fails the run, so the fix also
// removes its test.fail() and moves the test to regressions.test.ts.

import { expect, test } from '@playwright/test'
import { SECOND_ELECTRUM_SERVER, fund } from './chain'
import { proxyStats } from './proxy'
import { addWallet, depositAddress, expectBalance, openRegtestWallet, switchChipnetServer } from './app'

test.use({ colorScheme: 'light' })

// #375, first bug: a server change makes a new connection and never closes the one it replaced,
// so the deselected server keeps the app's connection (and its header subscription) open
test.fail('a server change leaves no connection open on the server it replaced', async ({ page }) => {
  await openRegtestWallet(page)
  await fund(await depositAddress(page), 100_000n)
  await expectBalance(page, '0.001')
  await expect.poll(async () => (await proxyStats()).a.connections).toBeGreaterThan(0)

  await switchChipnetServer(page, SECOND_ELECTRUM_SERVER)
  await expectBalance(page, '0.001')
  await expect.poll(async () => (await proxyStats()).b.connections).toBeGreaterThan(0)

  await expect.poll(async () => (await proxyStats()).a.connections, { timeout: 15_000 }).toBe(0)
})

// #375, second bug: after a server change, the next wallet of a network already connected is made
// on the old server, which sees its addresses before the wallet moves to the selected one. An HD
// wallet starts its address discovery as it is made, on the wallet library's global provider of
// the network, which keeps the server it was first made with.
test.fail('an HD wallet opened after a server change asks the old server about none of its addresses', async ({ page }) => {
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
