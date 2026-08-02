
<script setup lang="ts">
  import { ref, computed, nextTick, onActivated, onDeactivated } from 'vue'
  import { useI18n } from 'vue-i18n'
  import tokenItemNFT from './tokenItems/tokenItemNFT.vue'
  import tokenItemFT from './tokenItems/tokenItemFT.vue'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useWindowSize } from 'src/utils/composables'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const showOptions = ref(false)
  const searchQuery = ref('')
  const searchInputRef = ref<HTMLInputElement | null>(null)
  const { width } = useWindowSize()
  const isMobile = computed(() => width.value <= 600)
  // On mobile the search input hides behind a search icon until toggled open
  const showSearch = ref(false)

  async function toggleSearch() {
    if (showSearch.value) {
      showSearch.value = false;
      searchQuery.value = "";
      return;
    }
    showSearch.value = true;
    // the input is behind a v-if, wait for the DOM update before focusing it
    await nextTick();
    searchInputRef.value?.focus();
  }

  // Override Ctrl+F to focus the search input.
  function handleCtrlF(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
      event.preventDefault();
      showSearch.value = true;
      // the input is behind a v-if, wait for the DOM update before focusing it
      void nextTick().then(() => searchInputRef.value?.focus());
    }
  }

  // Listener added/removed on KeepAlive activate/deactivate so it only applies while this view is active.
  onActivated(() => document.addEventListener('keydown', handleCtrlF));
  onDeactivated(() => document.removeEventListener('keydown', handleCtrlF));

  const selectedTypeFilter = ref("all" as "all" | "fungibles" | "nfts");

  const typeFilterOptions = [
    { value: "all", label: "tokens.typeFilter.all" },
    { value: "fungibles", label: "tokens.typeFilter.fungibles" },
    { value: "nfts", label: "tokens.typeFilter.nfts" },
  ] as const;

  // Categories holding both fungibles and NFTs have a separate list entry for each,
  // so filtering on the entry kind cleanly splits them across the two views
  const typeFilteredTokenList = computed(() => {
    const tokens = store.filteredTokenList;
    if (!tokens) return null;
    if (selectedTypeFilter.value === "fungibles") return tokens.filter(tokenData => 'amount' in tokenData);
    if (selectedTypeFilter.value === "nfts") return tokens.filter(tokenData => 'nfts' in tokenData);
    return tokens;
  });

  const searchFilteredTokenList = computed(() => {
    const tokens = typeFilteredTokenList.value;
    if (!tokens) return null;
    const query = searchQuery.value.toLowerCase().trim();
    if (!query) return tokens;
    return tokens.filter(tokenData => {
      if (tokenData.category.toLowerCase().includes(query)) return true;
      const metadata = store.bcmrRegistries?.[tokenData.category];
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
  <div v-if="store.bcmrRegistries == undefined" style="text-align: center;">
    <template v-if="store.walletInitFailed">{{ t('tokens.loadingFailed') }}</template>
    <template v-else>{{ t('tokens.loading') }} <q-spinner-dots size="1.2em" /></template>
  </div>

  <div v-else>
    <!-- Options toggle row -->
    <div v-if="store.tokenList?.length" class="control-row">
      <div class="type-filter">
        <button
          v-for="option in typeFilterOptions"
          :key="option.value"
          :class="{ active: selectedTypeFilter === option.value }"
          @click="selectedTypeFilter = option.value"
        >{{ t(option.label) }}</button>
      </div>
      <input v-if="!isMobile || showSearch" ref="searchInputRef" v-model="searchQuery" type="text" :placeholder="t('tokens.searchPlaceholder')" class="search-input">
      <span v-if="isMobile" class="search-toggle" :class="{ active: showSearch || searchQuery.trim() }" @click="toggleSearch">
        <q-icon name="search" size="22px" />
      </span>
      <span class="options-toggle" :class="{ active: showOptions }" :title="t('tokens.options')" @click="showOptions = !showOptions">
        <q-icon name="tune" size="22px" />
      </span>
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
        {{ t('tokens.editVisibility') }} <q-toggle v-model="settingsStore.showTokenVisibilityToggle" dense />
      </div>
    </div>

    <!-- Token list -->
    <div v-if="store.tokenList?.length == 0" style="text-align: center;">
      {{ t('tokens.noTokens') }}
    </div>
    <div v-else-if="searchFilteredTokenList?.length == 0" style="text-align: center;">
      {{ t('tokens.noMatch') }}
    </div>
    <!-- categories holding both fungibles and NFTs have two list entries, so the
      category alone is not a unique key: duplicate keys break the keyed list diff
      and leave stale items behind when filtering -->
    <div v-for="tokenData in searchFilteredTokenList" :key="tokenData.category + ('amount' in tokenData ? '-ft' : '-nft')">
      <tokenItemFT v-if="'amount' in tokenData" :tokenData="tokenData"/>
      <tokenItemNFT v-else :tokenData="tokenData"/>
    </div>

    <div v-if="searchFilteredTokenList?.length" class="token-count">
      <!-- the curation labels only apply to the unnarrowed list, show a plain count when searching or type-filtering -->
      <span v-if="searchQuery.trim() || selectedTypeFilter !== 'all'">{{ t('tokens.count', { count: searchFilteredTokenList.length }) }}</span>
      <span v-else-if="settingsStore.tokenDisplayFilter === 'favoritesOnly'">{{ t('tokens.favoriteCount', { count: searchFilteredTokenList.length }) }}</span>
      <span v-else-if="settingsStore.tokenDisplayFilter === 'hiddenOnly'">{{ t('tokens.hiddenCount', { count: searchFilteredTokenList.length }) }}</span>
      <span v-else-if="settingsStore.tokenDisplayFilter === 'all'">{{ t('tokens.totalCount', { count: searchFilteredTokenList.length }) }}</span>
      <span v-else>{{ t('tokens.count', { count: searchFilteredTokenList.length }) }}</span>
    </div>
  </div>
</template>

<style scoped>
.control-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px 12px;
  margin: 10px;
}

.options-toggle,
.search-toggle {
  cursor: pointer;
  user-select: none;
  opacity: 0.8;
}

/* icons are taller than the lowercase text, drop them slightly below the
   baseline so they read as vertically centered next to it */
.options-toggle .q-icon,
.search-toggle .q-icon {
  vertical-align: -0.2em;
}

.options-toggle.active,
.search-toggle.active {
  color: var(--color-primary);
  opacity: 1;
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

/* segmented pill bar for the token type filter */
.type-filter {
  display: inline-flex;
  background-color: rgba(128, 128, 128, 0.12);
  border-radius: 20px;
  padding: 3px;
}

.type-filter button {
  border: none;
  margin: 0;
  background: transparent;
  color: inherit;
  border-radius: 17px;
  padding: 4px 16px;
  font-size: 0.9em;
  cursor: pointer;
}

.type-filter button.active {
  background-color: var(--color-primary);
  color: white;
}

.search-input {
  width: 180px;
  padding: 4px 10px;
  margin-left: auto;
}

.token-count {
  text-align: center;
  font-size: 0.85em;
  opacity: 0.6;
  margin: 10px 0 4px;
}

@media (max-width: 600px) {
  /* search moves to its own full-width line, the icons stay beside the pills */
  .search-input {
    order: 5;
    flex-basis: 100%;
    width: 100%;
    margin-left: 0;
  }
  .search-toggle {
    margin-left: auto;
  }
  .type-filter button {
    padding: 4px 12px;
    font-size: 0.85em;
  }
}
</style>
