
<script setup lang="ts">
  import { ref, computed, onActivated, onDeactivated } from 'vue'
  import Toggle from '@vueform/toggle'
  import { useI18n } from 'vue-i18n'
  import tokenItemNFT from './tokenItems/tokenItemNFT.vue'
  import tokenItemFT from './tokenItems/tokenItemFT.vue'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const showOptions = ref(false)
  const searchQuery = ref('')
  const searchInputRef = ref<HTMLInputElement | null>(null)

  // Override Ctrl+F to focus the search input.
  function handleCtrlF(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
      event.preventDefault();
      searchInputRef.value?.focus();
    }
  }

  // Listener added/removed on KeepAlive activate/deactivate so it only applies while this view is active.
  onActivated(() => document.addEventListener('keydown', handleCtrlF));
  onDeactivated(() => document.removeEventListener('keydown', handleCtrlF));

  const isSearchActive = computed(() => searchQuery.value.trim().length > 0);

  const searchFilteredTokenList = computed(() => {
    const tokens = store.filteredTokenList;
    if (!tokens) return null;
    const query = searchQuery.value.toLowerCase().trim();
    if (!query) return tokens;
    return tokens.filter(tokenData => {
      if (tokenData.tokenId.toLowerCase().includes(query)) return true;
      const metadata = store.bcmrRegistries?.[tokenData.tokenId];
      if (!metadata) return false;
      if (metadata.name.toLowerCase().includes(query)) return true;
      if (metadata.token.symbol.toLowerCase().includes(query)) return true;
      return false;
    });
  });

  function setFilter(filter: string) {
    settingsStore.tokenDisplayFilter = filter as typeof settingsStore.tokenDisplayFilter;
    localStorage.setItem("tokenDisplayFilter", filter);
  }
</script>

<template>
  <div v-if="store.bcmrRegistries == undefined" style="text-align: center;">{{ t('tokens.loading') }}</div>

  <div v-else>
    <!-- Options toggle row -->
    <div v-if="store.tokenList?.length" class="filter-row">
      <span :class="{ 'hide-mobile': isSearchActive }">
        <span v-if="settingsStore.tokenDisplayFilter === 'favoritesOnly'">{{ t('tokens.favoriteCount', { count: store.filteredTokenList?.length ?? 0 }) }}</span>
        <span v-else-if="settingsStore.tokenDisplayFilter === 'hiddenOnly'">{{ t('tokens.hiddenCount', { count: store.filteredTokenList?.length ?? 0 }) }}</span>
        <span v-else-if="settingsStore.tokenDisplayFilter === 'all'">{{ t('tokens.totalCount', { count: store.filteredTokenList?.length ?? 0 }) }}</span>
        <span v-else>{{ t('tokens.count', { count: store.filteredTokenList?.length ?? 0 }) }}</span>
        <span v-if="isSearchActive" class="search-match-suffix"> ({{ t('tokens.searchMatches', { count: searchFilteredTokenList?.length ?? 0 }) }})</span>
      </span>
      <span v-if="isSearchActive" class="search-match-mobile">{{ t('tokens.searchMatches', { count: searchFilteredTokenList?.length ?? 0 }) }}</span>
      <span class="options-toggle" @click="showOptions = !showOptions">
        {{ t('tokens.options') }}
        <img
          class="icon"
          :class="{ 'expanded': showOptions }"
          :src="settingsStore.darkMode ? 'images/chevron-square-down-lightGrey.svg' : 'images/chevron-square-down.svg'"
        >
      </span>
      <input ref="searchInputRef" v-model="searchQuery" type="text" :placeholder="t('tokens.searchPlaceholder')" class="search-input">
    </div>

    <!-- Options panel (collapsed by default) -->
    <div v-if="store.tokenList?.length && showOptions" class="options-panel" :class="{ dark: settingsStore.darkMode }">
      <div class="option-item">
        <label for="filterTokens">{{ t('tokens.filter.label') }}</label>
        <select v-model="settingsStore.tokenDisplayFilter" @change="setFilter(($event.target as HTMLSelectElement).value)" name="filterTokens">
          <option value="default">{{ t('tokens.filter.default') }}</option>
          <option value="favoritesOnly">{{ t('tokens.filter.favoritesOnly') }}</option>
          <option value="all">{{ t('tokens.filter.all') }}</option>
          <option value="hiddenOnly">{{ t('tokens.filter.hiddenOnly') }}</option>
        </select>
      </div>
      <div class="option-item">
        {{ t('tokens.editVisibility') }} <Toggle v-model="settingsStore.showTokenVisibilityToggle"/>
      </div>
    </div>

    <!-- Token list -->
    <div v-if="store.tokenList?.length == 0" style="text-align: center;">
      {{ t('tokens.noTokens') }}
    </div>
    <div v-else-if="searchFilteredTokenList?.length == 0" style="text-align: center;">
      {{ t('tokens.noMatch') }}
    </div>
    <div v-for="tokenData in searchFilteredTokenList" :key="tokenData.tokenId">
      <tokenItemFT v-if="'amount' in tokenData" :tokenData="tokenData"/>
      <tokenItemNFT v-else :tokenData="tokenData"/>
    </div>
  </div>
</template>

<style scoped>
.filter-row {
  display: flex;
  align-items: baseline;
  gap: 20px;
  margin: 10px;
}

.options-toggle {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.expanded {
  transform: rotate(180deg);
}

.options-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 15px 25px;
  padding: 10px 12px;
  margin: 0 10px 10px 10px;
  background-color: var(--color-background-soft);
  border-radius: 6px;
}

.options-panel.dark {
  background-color: #232326;
}

.option-item {
  margin-top: -5px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.option-item select {
  width: 130px;
  padding: 2px 8px;
}

.search-match-mobile {
  display: none;
}

.search-input {
  width: 160px;
  padding: 4px 10px;
  margin-left: auto;
}

@media (max-width: 450px) {
  .hide-mobile {
    display: none;
  }

  .search-match-mobile {
    display: inline;
  }

  .search-input {
    width: 140px;
    padding: 2px 10px;
  }
}
</style>
