// The fiat value the wallet shows for an amount of a fungible token: Cauldron's pool price, and
// only where the token list shows one (the user option on, mainnet, a pool with enough liquidity).

import { useStore } from 'src/stores/store'
import { useSettingsStore } from 'src/stores/settingsStore'
import { calculateTokenFiatValue } from 'src/utils/defi/cauldronApi'

export function shownTokenFiatValue(category: string, amount: bigint): number | null {
  const store = useStore()
  const settingsStore = useSettingsStore()
  if (!settingsStore.showCauldronFTValue || store.network !== 'mainnet') return null
  const poolPriceData = store.cauldronPrices?.[category]
  if (!poolPriceData || store.exchangeRate === undefined) return null
  return calculateTokenFiatValue(amount, poolPriceData, store.exchangeRate)
}
