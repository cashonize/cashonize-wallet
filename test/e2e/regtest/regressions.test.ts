// Bugs the app had on mainnet-js, each a test of the right behavior, all fixed by the move to
// bch-wallet-lib (#371), where they stopped being expected failures. Each comment says what
// mainnet-js did.
// TODO: the most specific of these, such as the mutable NFT send with a minting NFT in the wallet,
// guard one shape of a bug the library now rules out as a whole (token change derived from the
// spent coins, a burn refused unless asked for); they can go once the library's own tests cover
// those shapes and keep them out.

import { expect, test } from '@playwright/test'
import { createToken, decodedTransaction, fund, fundTokenCoins, issuerTokens, randomAddress, rpc, spentCoins, spentTokenCoins } from './chain'
import { dropNextBroadcast } from './proxy'
import { broadcastTxid, confirmIfAsked, depositAddress, errorNotification, expectBalance, openRegtestWallet, openTokenItem, sendFungibleTokens, sendNft, tokenDepositAddress } from './app'

test.use({ colorScheme: 'light' })

// mainnet-js builds a fungible send's token change from the request alone, so an NFT on a coin
// that also holds fungible tokens is left out of the outputs and destroyed (mainnet-js#247, #314)
test('a fungible send keeps the minting NFT that shares the coin', async ({ page }) => {
  await openRegtestWallet(page)
  await fund(await depositAddress(page), 100_000n)
  const category = await createToken(await tokenDepositAddress(page), {
    amount: 1000n, nft: { capability: 'minting', commitment: '' },
  })
  await expectBalance(page, '0.001')

  const txid = await sendFungibleTokens(page, category, randomAddress('p2pkhWithTokens'), '300')

  const outputs = (await decodedTransaction(txid)).vout.filter(output => output.tokenData?.category === category)
  expect(outputs.some(output => output.tokenData!.nft?.capability === 'minting')).toBe(true)
})

// mainnet-js spends every coin of the category for a fungible send, linking all the addresses that
// hold it in one transaction (#314)
test('a fungible send spends only the token coins its amount needs', async ({ page }) => {
  await openRegtestWallet(page)
  await fund(await depositAddress(page), 100_000n)
  const category = await fundTokenCoins(await tokenDepositAddress(page), 3, 100n)
  await expectBalance(page, '0.001')

  const txid = await sendFungibleTokens(page, category, randomAddress('p2pkhWithTokens'), '50')

  const spent = (await spentTokenCoins(txid)).filter(token => token?.category === category)
  expect(spent).toHaveLength(1)
})

// mainnet-js estimates a token send's fee from every coin of the wallet, not the ones it spends, so
// a wallet holding many coins of other tokens cannot send a token from a little BCH: "Amount
// required was not met" (#150)
test('a token send pays a fee for the coins it spends, not for every coin of the wallet', async ({ page }) => {
  await openRegtestWallet(page)
  await fund(await depositAddress(page), 3_000n)
  await fundTokenCoins(await tokenDepositAddress(page), 80, 10n)
  const category = await createToken(await tokenDepositAddress(page), { amount: 100n })
  await expectBalance(page, '0.00003')

  // the send going through is the assertion: on mainnet-js the app shows the shortfall instead,
  // which sendFungibleTokens throws on
  await sendFungibleTokens(page, category, randomAddress('p2pkhWithTokens'), '5')
})

// mainnet-js adds a send's token change for every category it sends, with the first output's NFT
// on it. A mutable NFT send from a wallet holding fungible tokens of the category so puts a
// second copy of the mutable NFT on the change, which only a minting NFT among the inputs can
// back: the one carrying the fungible reserve, pulled in with every coin of the category and
// returned nowhere, so it is burned
test('a mutable NFT send keeps one copy of it and the minting NFT the wallet holds', async ({ page }) => {
  await openRegtestWallet(page)
  await fund(await depositAddress(page), 100_000n)
  const { category, mutable } = await issuerTokens(await tokenDepositAddress(page), 1000n)
  await expectBalance(page, '0.001')

  const txid = await sendNft(page, category, mutable, randomAddress('p2pkhWithTokens'))

  const outputs = (await decodedTransaction(txid)).vout.filter(output => output.tokenData?.category === category)
  expect(outputs.filter(output => output.tokenData!.nft?.capability === 'mutable')).toHaveLength(1)
  // a send that spends the minting NFT returns it; one that leaves it alone keeps it too
  const spent = await spentTokenCoins(txid)
  const mintingSpent = spent.some(token => token?.category === category && token.nft?.capability === 'minting')
  const mintingReturned = outputs.some(output => output.tokenData!.nft?.capability === 'minting')
  expect(mintingSpent && !mintingReturned).toBe(false)
})

// mainnet-js returns a mint's minting NFT to the address it came from, so an HD wallet's token
// issuance stays on one reused address, where change goes to a fresh change address
test('a mint sends the minting NFT on to a fresh change address of the HD wallet', async ({ page }) => {
  await openRegtestWallet(page, { walletType: 'hd', settings: { mintNfts: 'true' } })
  await fund(await depositAddress(page), 100_000n)
  const category = await createToken(await tokenDepositAddress(page), { nft: { capability: 'minting', commitment: '' } })
  await expectBalance(page, '0.001')

  const item = await openTokenItem(page, category)
  await item.getByText('mint NFTs').click()
  await item.getByPlaceholder('commitment (hex)').fill('01')
  await item.getByPlaceholder('quantity').fill('1')
  await item.locator('input.primaryButton[value="Mint NFTs"]').click()
  await confirmIfAsked(page)
  const txid = await broadcastTxid(page)

  const mintingIn = (await spentCoins(txid)).find(coin => coin.tokenData?.nft?.capability === 'minting')
  const mintingOut = (await decodedTransaction(txid)).vout.find(output => output.tokenData?.nft?.capability === 'minting')
  expect(mintingOut?.scriptPubKey.addresses?.[0]).toBeDefined()
  expect(mintingOut?.scriptPubKey.addresses?.[0]).not.toBe(mintingIn?.scriptPubKey.addresses?.[0])
})

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
