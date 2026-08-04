<script setup lang="ts">
  import { computed } from 'vue';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { getTokenUtxos, getFungibleTokenBalances, getAllNftTokenBalances } from 'src/utils/utils';
  import type { Utxo } from 'mainnet-js';
  import TokenIcon from 'src/components/general/TokenIcon.vue'

  const store = useStore()
  const settingsStore = useSettingsStore()

  const props = defineProps<{
    utxos: Utxo[];
  }>();

  interface AddressTokenChip {
    key: string;
    category: string;
    amountText: string;
    symbol: string;
  }

  // Token balances on a single address, shaped like the token chips on the history page
  const chips = computed(() => {
    const tokenUtxos = getTokenUtxos(props.utxos);
    const fungibleBalances = getFungibleTokenBalances(tokenUtxos);
    const nftBalances = getAllNftTokenBalances(tokenUtxos);
    const result: AddressTokenChip[] = [];
    for (const [category, amount] of Object.entries(fungibleBalances)) {
      const tokenMetadata = store.bcmrRegistries?.[category]?.token;
      const symbol = tokenMetadata?.symbol ?? category.slice(0, 8);
      const decimals = tokenMetadata?.decimals ?? 0;
      const displayAmount = Number(amount) / 10 ** decimals;
      result.push({
        key: category + "-ft",
        category,
        amountText: displayAmount.toLocaleString("en-US", { maximumFractionDigits: decimals }),
        symbol,
      });
    }
    for (const [category, nftCount] of Object.entries(nftBalances)) {
      const symbol = store.bcmrRegistries?.[category]?.token?.symbol ?? category.slice(0, 8);
      result.push({
        key: category + "-nft",
        category,
        amountText: String(nftCount),
        symbol: `${symbol} NFT`,
      });
    }
    return result;
  });
</script>

<template>
  <div class="address-tokens">
    <div class="token-chip" v-for="chip in chips" :key="chip.key">
      <TokenIcon
        :token-id="chip.category"
        :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(chip.category) : undefined"
        :size="22"
      />
      <span class="mono">{{ chip.amountText }}</span>
      <span class="chip-symbol">{{ chip.symbol }}</span>
    </div>
  </div>
</template>

<style scoped>
/* panel connects to the flattened bottom corners of the expanded address card above it */
.address-tokens {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-top: none;
  border-radius: 0 0 12px 12px;
  background-color: rgba(128, 128, 128, 0.03);
  padding: 10px 14px;
  margin-bottom: 6px;
}

/* token balances render as chips, same as token changes on the history page */
.token-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  background-color: rgba(128, 128, 128, 0.08);
  border-radius: 14px;
  padding: 2px 10px 2px 4px;
  font-size: 0.85em;
}

.chip-symbol {
  word-break: break-word;
}

.mono {
  font-family: monospace;
}
</style>
