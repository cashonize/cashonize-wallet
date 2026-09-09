import { ref, onMounted, onUnmounted, getCurrentInstance, type Ref } from 'vue'
import { useStore } from 'src/stores/store'
import { useSettingsStore } from 'src/stores/settingsStore'
import { formatTokenAmount, gatewayUrl } from 'src/utils/utils'
import type { BcmrTokenResponse } from 'src/utils/zodValidation'

interface UseWindowSizeReturn {
  width: Ref<number>
  height: Ref<number>
}

// Minimal useWindowSize, adapted from @vueuse/core
// https://github.com/vueuse/vueuse/blob/main/packages/core/useWindowSize/index.ts
export function useWindowSize(): UseWindowSizeReturn {
  const width = ref(window.innerWidth)
  const height = ref(window.innerHeight)

  function update() {
    width.value = window.innerWidth
    height.value = window.innerHeight
  }

  // When called inside a component setup, register lifecycle hooks
  // When called at module scope (e.g. store init), the listener stays for the app lifetime
  if (getCurrentInstance()) {
    onMounted(() => window.addEventListener('resize', update))
    onUnmounted(() => window.removeEventListener('resize', update))
  } else {
    window.addEventListener('resize', update)
  }

  return { width, height }
}

// The metadata of categories the wallet does not hold, which a sweep preview and a dapp's
// transaction both have to show: coins about to arrive, or that never will. Fetched into the
// dialog rather than into the store's registries, so nothing the wallet vouches for is written
// from a request. A category the wallet does hold reads from the store, which is what makes
// isUnverifiedToken the mark for metadata this dialog looked up itself.
export function useUnverifiedTokenMetadata() {
  const store = useStore()
  const settingsStore = useSettingsStore()
  const unverifiedTokenMetadata = ref<Record<string, BcmrTokenResponse>>({})

  async function fetchUnverifiedTokenInfo(categoryHex: string) {
    try {
      const tokenInfo = await store.fetchTokenInfo(categoryHex)
      unverifiedTokenMetadata.value = { ...unverifiedTokenMetadata.value, [categoryHex]: tokenInfo }
    } catch (error) {
      console.error(`Failed to fetch metadata for ${categoryHex}:`, error)
    }
  }

  function getTokenMetadata(categoryHex: string): BcmrTokenResponse | undefined {
    return store.bcmrRegistries?.[categoryHex] ?? unverifiedTokenMetadata.value[categoryHex]
  }

  function isUnverifiedToken(categoryHex: string): boolean {
    const userOwnsToken = store.tokenList?.some(token => token.category === categoryHex)
    return !userOwnsToken && categoryHex in unverifiedTokenMetadata.value
  }

  function tokenIconUrl(categoryHex: string): string | undefined {
    const tokenIconUri = getTokenMetadata(categoryHex)?.uris?.icon
    if (!tokenIconUri) return undefined
    return gatewayUrl(tokenIconUri, settingsStore.ipfsGateway)
  }

  function tokenAmountDisplay(amount: bigint, categoryHex: string): string {
    return formatTokenAmount(amount, getTokenMetadata(categoryHex)?.token?.decimals)
  }

  // a preview that is being rebuilt keeps nothing of the last one
  function forget() {
    unverifiedTokenMetadata.value = {}
  }

  return {
    unverifiedTokenMetadata,
    fetchUnverifiedTokenInfo,
    getTokenMetadata,
    isUnverifiedToken,
    tokenIconUrl,
    tokenAmountDisplay,
    forget,
  }
}
