
<script setup lang="ts">
  import { ref } from 'vue'
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
      <div v-if="settingsStore.tokenDisplayFilter === 'favoritesOnly'">{{ t('tokens.favoriteCount', { count: store.filteredTokenList?.length ?? 0 }) }}</div>
      <div v-else-if="settingsStore.tokenDisplayFilter === 'hiddenOnly'">{{ t('tokens.hiddenCount', { count: store.filteredTokenList?.length ?? 0 }) }}</div>
      <div v-else-if="settingsStore.tokenDisplayFilter === 'all'">{{ t('tokens.totalCount', { count: store.filteredTokenList?.length ?? 0 }) }}</div>
      <div v-else>{{ t('tokens.count', { count: store.filteredTokenList?.length ?? 0 }) }}</div>
      <span class="options-toggle" @click="showOptions = !showOptions">
        {{ t('tokens.options') }}
        <img
          class="icon"
          :class="{ 'expanded': showOptions }"
          :src="settingsStore.darkMode ? 'images/chevron-square-down-lightGrey.svg' : 'images/chevron-square-down.svg'"
        >
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
        {{ t('tokens.editVisibility') }} <Toggle v-model="settingsStore.showTokenVisibilityToggle"/>
      </div>
    </div>

    <!-- Token list -->
    <div v-if="store.tokenList?.length == 0" style="text-align: center;">
      {{ t('tokens.noTokens') }}
    </div>
    <div v-else-if="store.filteredTokenList?.length == 0" style="text-align: center;">
      {{ t('tokens.noMatch') }}
    </div>
    <div v-for="tokenData in store.filteredTokenList" :key="tokenData.tokenId">
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
</style>
