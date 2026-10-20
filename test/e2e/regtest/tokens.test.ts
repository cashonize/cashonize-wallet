// Token operations the app gets right on the regtest chain.

import { expect, test } from '@playwright/test'
import { createToken, decodedTransaction, fund, randomAddress } from './chain'
import { depositAddress, expectBalance, openRegtestWallet, sendFungibleTokens, tokenDepositAddress } from './app'

test.use({ colorScheme: 'light' })

test('sends fungible tokens, keeping the rest as change', async ({ page }) => {
  await openRegtestWallet(page)
  await fund(await depositAddress(page), 100_000n)
  const category = await createToken(await tokenDepositAddress(page), { amount: 1000n })
  await expectBalance(page, '0.001')

  const txid = await sendFungibleTokens(page, category, randomAddress('p2pkhWithTokens'), '300')

  const outputs = (await decodedTransaction(txid)).vout.filter(output => output.tokenData?.category === category)
  expect(outputs.map(output => output.tokenData!.amount).sort()).toEqual(['300', '700'])
})
