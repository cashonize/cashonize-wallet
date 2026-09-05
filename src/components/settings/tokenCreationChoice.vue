<script setup lang="ts">
  // Which tool creates the token: this page, or CashTokens Studio with its AuthGuard covenant.
  // Only the first continues here; the second is a link out. Either way the identity can be
  // moved afterwards.
  import { ref } from 'vue';
  import { CASHTOKENS_STUDIO_URL } from 'src/utils/tools/authchainIdentity';
  import InfoPopup from '../general/InfoPopup.vue';
  import { useStore } from 'src/stores/store';
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useI18n } from 'vue-i18n';

  const emit = defineEmits<{ continue: [] }>();
  const store = useStore();
  const settingsStore = useSettingsStore();
  const { t } = useI18n();

  const selectedHome = ref<'wallet' | 'studio' | undefined>(undefined);
  const cardLines = ['for', 'managed'] as const;
  const homeRows = ['protection', 'metadata', 'operations'] as const;
</script>

<template>
  <div>{{ t('createTokens.home.intro') }}</div>
  <div class="home-cards">
    <div class="home-card" :class="{ selected: selectedHome === 'wallet' }" @click="selectedHome = 'wallet'">
      <div class="home-card-title">
        <span class="home-radio"></span>
        <b>{{ t('createTokens.home.wallet') }}</b>
        <img src="images/cashonize-icon.png" class="home-mark">
      </div>
      <div v-for="line in cardLines" :key="line">
        <b>{{ t(`createTokens.home.cardLeads.${line}`) }}</b> {{ t(`createTokens.home.walletLines.${line}`) }}
      </div>
    </div>
    <div class="home-card" :class="{ selected: selectedHome === 'studio' }" @click="selectedHome = 'studio'">
      <div class="home-card-title">
        <span class="home-radio"></span>
        <b>{{ t('createTokens.home.studio') }}</b>
        <img src="images/studio.png" class="home-mark">
      </div>
      <div v-for="line in cardLines" :key="line">
        <b>{{ t(`createTokens.home.cardLeads.${line}`) }}</b> {{ t(`createTokens.home.studioLines.${line}`) }}
      </div>
    </div>
  </div>
  <div v-if="selectedHome" class="section home-rows">
    <div v-for="row in homeRows" :key="row">
      <b>{{ t(`createTokens.home.leads.${row}`) }}</b> {{ t(`createTokens.home.${selectedHome}Rows.${row}`) }}
      <InfoPopup v-if="selectedHome === 'studio' && (row === 'protection' || row === 'metadata')">
        <div style="max-width: 300px;">{{ t(`createTokens.home.studioRows.${row}Help`) }}</div>
      </InfoPopup>
    </div>
    <div class="description">{{ t(`createTokens.home.${selectedHome}Rows.moveLater`) }}</div>
    <input
      v-if="selectedHome === 'wallet'"
      @click="emit('continue')"
      type="button"
      class="primaryButton"
      :value="t('createTokens.home.continueButton')"
      style="margin-top: 10px;"
    >
    <template v-else>
      <div class="info-box" style="margin: 10px 0 16px;">
        <img class="warning-box-icon" :src="settingsStore.darkMode ? 'images/infoLightGrey.svg' : 'images/info.svg'" width="20" height="20">
        <div>{{ t('createTokens.home.studioBox') }}</div>
      </div>
      <div class="studio-actions">
        <a :href="CASHTOKENS_STUDIO_URL[store.network]" target="_blank" class="button primaryButton studio-button">
          {{ t('createTokens.home.openStudio') }}
          <img src="images/external-link-white.svg">
        </a>
        <input type="button" :value="t('createTokens.home.connectButton')" @click="store.changeView(4)">
      </div>
    </template>
  </div>
</template>

<style scoped>
/* the negative margin lets the pair borrow most of the fieldset's 2rem inset */
.home-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
  margin: 20px -1.25rem 0;
}
.home-card {
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
}
.dark .home-card {
  border-color: #333;
}
.home-card:hover {
  border-color: rgba(128, 128, 128, 0.4);
}
.home-card.selected {
  border-color: var(--color-primary);
  cursor: default;
}
.home-card > div {
  margin-top: 3px;
}
.home-card > .home-card-title + div {
  margin-top: 6px;
}
.home-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 0;
}
.home-radio {
  flex: none;
  width: 16px;
  height: 16px;
  border: 2px solid grey;
  border-radius: 50%;
}
.home-card.selected .home-radio {
  border-color: var(--color-primary);
  background: radial-gradient(circle, var(--color-primary) 45%, transparent 50%);
}
.home-mark {
  width: 20px;
  height: 20px;
  flex: none;
}
.home-rows div {
  margin-top: 4px;
}
.studio-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 10px;
}
.studio-actions input {
  margin: 0;
}
.studio-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
}
/* an anchor styled as a button: hover by fading like the buttons, not by the anchor tint */
.studio-button:hover {
  background-color: var(--color-primary);
  opacity: 0.8;
}
</style>
