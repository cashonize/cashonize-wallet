<script setup lang="ts">
  // The finish of the create page: the closed steps with their ticks, then the token as the
  // Tokens tab will show it, with the next thing to do beside it. Stays until the user starts over.
  import { formatTokens, stepLabel, type CreatedToken } from 'src/utils/tools/tokenCreation';
  import { copyToClipboard, truncateHash } from 'src/utils/utils';
  import TokenIcon from '../general/TokenIcon.vue';
  import { useStore } from 'src/stores/store';
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useI18n } from 'vue-i18n';

  const props = defineProps<{ created: CreatedToken }>();
  const emit = defineEmits<{ startOver: [] }>();
  const store = useStore();
  const settingsStore = useSettingsStore();
  const { t } = useI18n();

  // the token list narrows itself to a pending search on arrival, so the new token is the one shown
  function openInTokenList() {
    store.pendingTokenSearch = props.created.category;
    store.changeView(2);
  }

  function createdAmount(baseUnits: bigint) {
    const amount = formatTokens(baseUnits, props.created.decimals);
    return props.created.symbol ? `${amount} ${props.created.symbol}` : amount;
  }
</script>

<template>
  <div class="closed-line description">
    <img src="images/check-circle.svg" class="step-check">
    <span>{{ t('createTokens.home.chosen') }}</span>
  </div>
  <div class="closed-line description">
    <img src="images/check-circle.svg" class="step-check">
    <span>{{ t('createTokens.plannedTokenId') }}</span>
    <span class="copy-target" @click="copyToClipboard(created.category)">
      <span class="mono">{{ truncateHash(created.category) }}</span>
      <img class="copyIcon" src="images/copyGrey.svg">
    </span>
  </div>
  <div class="closed-line description">
    <img src="images/check-circle.svg" class="step-check">
    <span>{{ stepLabel(2, 3, t(`createTokens.stepTitles.${created.hasSupply ? 'shape' : 'type'}`)) }}</span>
  </div>
  <div class="closed-line description">
    <img src="images/check-circle.svg" class="step-check">
    <span>{{ stepLabel(3, 3, t('createTokens.stepTitles.metadata')) }}</span>
  </div>

  <div class="section created-title">{{ t('createTokens.created.title') }}</div>
  <div class="created-card">
    <!-- keyed on the category because the generated icon is only drawn when the component mounts -->
    <TokenIcon :key="created.category" :token-id="created.category" :icon-url="created.iconUrl" :size="48" class="pop" />
    <div>
      <div v-if="created.name"><b>{{ created.symbol ? `${created.name} (${created.symbol})` : created.name }}</b></div>
      <div v-else class="copy-target" @click="copyToClipboard(created.category)">
        <span class="mono">{{ truncateHash(created.category) }}</span>
        <img class="copyIcon" src="images/copyGrey.svg">
      </div>
      <div v-if="created.hasSupply">{{ t('createTokens.created.supply', { amount: createdAmount(created.supply) }) }}</div>
      <div v-else>{{ t('createTokens.created.mintingNft') }}</div>
      <div v-if="created.hasSupply">
        {{ t('createTokens.created.split', { reserve: createdAmount(created.reserve), circulating: createdAmount(created.circulating) }) }}
      </div>
      <div v-if="created.hasSupply && !created.name">{{ t('createTokens.created.decimals', { decimals: created.decimals }) }}</div>
      <div class="description">{{ t('createTokens.created.listed') }}</div>
    </div>
  </div>
  <div v-if="!created.name" style="margin-top: 10px;">
    <i18n-t keypath="createTokens.created.untilPublished" tag="span">
      <template #link>
        <span class="action-link" @click="store.changeView(19)">{{ t('createTokens.created.untilPublishedLink') }}</span>
      </template>
    </i18n-t>
  </div>
  <div class="created-actions">
    <input type="button" :value="t('createTokens.created.seeToken')" @click="openInTokenList()">
    <input type="button" :value="t('createTokens.created.seeIdentity')" @click="store.changeView(19)">
  </div>
  <div class="created-links">
    <a v-if="created.txId" :href="`${store.explorerUrl}/${created.txId}`" target="_blank" class="action-link">
      {{ t('createTokens.created.viewTransaction') }}
      <img :src="settingsStore.darkMode ? 'images/external-link-grey.svg' : 'images/external-link.svg'" style="vertical-align: sub;">
    </a>
    <span class="action-link" @click="emit('startOver')">{{ t('createTokens.created.createAnother') }}</span>
  </div>
</template>

<style scoped>
.created-title {
  font-size: 1.2em;
  font-weight: bold;
}
.created-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}
.dark .created-card {
  border-color: #333;
}
.created-card > div > div {
  margin-top: 2px;
}
.created-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 15px;
}
.created-actions input {
  margin: 0;
}
.created-links {
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
  margin-top: 10px;
}
</style>
