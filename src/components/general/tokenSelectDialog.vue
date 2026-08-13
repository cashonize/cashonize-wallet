<script setup lang="ts">
  import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
  import { useDialogPluginComponent } from 'quasar'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import { formatNumber } from 'src/utils/utils'
  import type { TokenDataFT } from 'src/interfaces/interfaces'
  import TokenIcon from 'src/components/general/TokenIcon.vue'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  defineProps<{
    title: string,
    hint: string,
  }>()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])

  const { dialogRef, onDialogHide, onDialogOK } = useDialogPluginComponent()

  const searchQuery = ref("");
  const searchInputRef = ref<HTMLInputElement | null>(null);
  const lookingUpTokenId = ref(false);
  const lookupFailed = ref(false);

  interface TokenOption {
    category: string;
    /** Balance in base units, zero for a token only seen in the history */
    amount: bigint;
  }

  // The full token list rather than the filtered one: hiding a token from the overview
  // is about the overview, it should not keep the user from requesting that token
  const fungibleTokens = computed(() =>
    store.tokenList?.filter((tokenData): tokenData is TokenDataFT => 'amount' in tokenData) ?? []
  );

  // Fungible categories the wallet moved before but no longer holds. Having spent a token
  // down to zero is no reason to stop being able to ask for more of it.
  const historyCategories = computed(() => {
    const categories: string[] = [];
    const heldCategories = fungibleTokens.value.map(tokenData => tokenData.category);
    for (const transaction of store.walletHistory ?? []) {
      for (const tokenChange of transaction.tokenAmountChanges) {
        // a category that only ever moved as an NFT is not requestable as a fungible
        if (tokenChange.amount === 0n) continue;
        if (heldCategories.includes(tokenChange.category)) continue;
        if (categories.includes(tokenChange.category)) continue;
        categories.push(tokenChange.category);
      }
    }
    return categories;
  });

  const tokenOptions = computed<TokenOption[]>(() => [
    ...fungibleTokens.value.map(tokenData => ({ category: tokenData.category, amount: tokenData.amount })),
    ...historyCategories.value.map(category => ({ category, amount: 0n })),
  ]);

  // Searches the same fields as the token list page: category, name and symbol
  const searchedTokens = computed(() => {
    const query = searchQuery.value.toLowerCase().trim();
    if (!query) return tokenOptions.value;
    return tokenOptions.value.filter(option => {
      if (option.category.toLowerCase().includes(query)) return true;
      const metadata = metadataFor(option.category);
      if (!metadata) return false;
      if (metadata.name.toLowerCase().includes(query)) return true;
      return metadata.token.symbol.toLowerCase().includes(query);
    });
  });

  // A category the wallet never touched can still be requested, by pasting its id into the
  // same search field. Recognized on the query alone, the lookup itself waits for a click.
  const pastedTokenId = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(query)) return undefined;
    if (searchedTokens.value.length) return undefined;
    return query;
  });

  async function selectPastedTokenId(category: string) {
    if (lookingUpTokenId.value) return;
    lookupFailed.value = false;
    // metadata carries the decimals the requested amount is expressed in, so a token
    // without it cannot be requested by amount at all
    if (!metadataFor(category)) {
      lookingUpTokenId.value = true;
      try {
        await store.fetchTokenMetadata([{ category, amount: 0n }], false);
      } finally {
        lookingUpTokenId.value = false;
      }
      if (!metadataFor(category)) {
        lookupFailed.value = true;
        return;
      }
    }
    onDialogOK(category);
  }

  // Token names are claims, not identities: anyone can register metadata under a name that
  // is already taken. Names shared by more than one of the listed tokens are marked, so the
  // token id below the name is what the choice comes down to. Computed over every option
  // rather than the search results, a filtered out impersonator is still an impersonator.
  const collidingNames = computed(() => {
    const seenNames: string[] = [];
    const duplicateNames: string[] = [];
    for (const option of tokenOptions.value) {
      const name = normalizedName(option.category);
      if (!name) continue;
      if (seenNames.includes(name) && !duplicateNames.includes(name)) duplicateNames.push(name);
      seenNames.push(name);
    }
    return duplicateNames;
  });

  function metadataFor(category: string) {
    return store.bcmrRegistries?.[category];
  }

  function normalizedName(category: string) {
    return metadataFor(category)?.name?.trim().toLowerCase();
  }

  function hasNameCollision(category: string) {
    const name = normalizedName(category);
    return name !== undefined && collidingNames.value.includes(name);
  }

  function shortCategory(category: string) {
    return `${category.slice(0, 8)}...${category.slice(-8)}`;
  }

  function tokenName(category: string) {
    return metadataFor(category)?.name ?? shortCategory(category);
  }

  function heldAmount(option: TokenOption) {
    const decimals = metadataFor(option.category)?.token?.decimals ?? 0;
    const amountInTokens = decimals ? Number(option.amount) / (10 ** decimals) : Number(option.amount);
    const symbol = metadataFor(option.category)?.token?.symbol ?? "";
    return `${formatNumber(amountInTokens, decimals)} ${symbol}`.trim();
  }

  // A failed lookup belongs to the id that was tried, not to the next one
  watch(searchQuery, () => {
    lookupFailed.value = false;
  });

  // Override Ctrl+F to focus the search input, as the token list and history pages do
  function handleCtrlF(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
      event.preventDefault();
      searchInputRef.value?.focus();
    }
  }

  // The dialog is mounted for as long as it is open, so the listener follows its lifetime
  onMounted(() => document.addEventListener('keydown', handleCtrlF));
  onBeforeUnmount(() => document.removeEventListener('keydown', handleCtrlF));
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" transition-show="scale" transition-hide="scale">
    <q-card class="dialogCard">
      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">{{ title }}</legend>
        <div>{{ hint }}</div>
        <!-- always available: a wallet holding no fungible tokens is exactly the one that
             needs to paste a token id -->
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          :placeholder="t('requestPayment.searchOrPasteId')"
          class="search-input"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
        >
        <div v-if="pastedTokenId" class="token-list">
          <div class="token-item" :title="pastedTokenId" @click="selectPastedTokenId(pastedTokenId)">
            <q-icon name="search" size="28px" class="lookup-icon" />
            <div class="token-info">
              <div class="token-name">
                {{ t('requestPayment.lookupTokenId') }}
                <q-spinner-dots v-if="lookingUpTokenId" size="1.2em" />
              </div>
              <div class="token-sub mono">{{ shortCategory(pastedTokenId) }}</div>
            </div>
          </div>
          <div v-if="lookupFailed" class="lookup-failed">{{ t('requestPayment.lookupFailed') }}</div>
        </div>
        <div v-else-if="!tokenOptions.length" class="no-tokens">{{ t('requestPayment.noFungibleTokens') }}</div>
        <div v-else-if="!searchedTokens.length" class="no-tokens">{{ t('tokens.noMatch') }}</div>
        <div v-else class="token-list">
          <div
            v-for="option in searchedTokens"
            :key="option.category"
            class="token-item"
            :title="option.category"
            @click="onDialogOK(option.category)"
          >
            <TokenIcon
              :token-id="option.category"
              :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(option.category) : undefined"
            />
            <div class="token-info">
              <div class="token-name">
                {{ tokenName(option.category) }}
                <q-icon
                  v-if="hasNameCollision(option.category)"
                  name="warning"
                  size="16px"
                  class="collision-icon"
                  :title="t('requestPayment.nameCollision')"
                />
              </div>
              <div class="token-sub">
                <span class="mono">{{ shortCategory(option.category) }}</span> · {{ heldAmount(option) }}
              </div>
            </div>
          </div>
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.dialogFieldset {
  padding: 2rem;
  width: 550px;
  max-width: 100%;
}
.search-input {
  width: 100%;
  padding: 4px 10px;
  margin-top: 10px;
}
.no-tokens {
  opacity: 0.6;
  margin-top: 10px;
}
.lookup-icon {
  opacity: 0.5;
}
.lookup-failed {
  color: red;
  margin-top: 6px;
}
.token-list {
  max-height: 350px;
  overflow-y: auto;
  overflow-x: hidden;
  margin-top: 10px;
}
/* neutral grey alphas keep the cards theme-agnostic, same as the address list */
.token-item {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid rgba(128, 128, 128, 0.2);
  background-color: rgba(128, 128, 128, 0.06);
  border-radius: 12px;
  padding: 8px 14px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.token-item:hover {
  background-color: rgba(128, 128, 128, 0.14);
}
.token-info {
  min-width: 0;
}
.token-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collision-icon {
  color: #e6a23c;
  vertical-align: -0.2em;
}
.token-sub {
  font-size: 0.85em;
  opacity: 0.65;
}
.mono {
  font-family: monospace;
}
</style>
