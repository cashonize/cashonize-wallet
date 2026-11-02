<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import { copyToClipboard } from 'src/utils/utils'
  import { convertAddress } from 'src/utils/tools/addressConverter'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const addressInput = ref("");

  // a prefix-less cashaddr and a locking bytecode name no network, they are read on the active one
  const activePrefix = computed(() => store.network === 'mainnet' ? 'bitcoincash' : 'bchtest');
  const converted = computed(() => convertAddress(addressInput.value, activePrefix.value));

  // chipnet and testnet4 share the bchtest prefix, so an address cannot tell them apart
  const networkNames = { bitcoincash: 'mainnet', bchtest: 'chipnet / testnet4', bchreg: 'regtest' };

  // the wallet can briefly be unset mid wallet-switch, the KeepAlive-cached view guards itself
  const isOwnAddress = computed(() => {
    if (!converted.value || !store._wallet) return false;
    return store.walletHasAddress(converted.value.cashAddress);
  });

  const copyIconSrc = computed(() => settingsStore.darkMode ? 'images/copyGrey.svg' : 'images/copy.svg')
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('addressConverter.title') }}</legend>

    <div>{{ t('addressConverter.description') }}</div>

    <input
      v-model="addressInput"
      type="text"
      :placeholder="t('addressConverter.inputPlaceholder')"
      style="width: 100%; margin-top: 15px;"
    >

    <div v-if="addressInput.trim() && !converted" style="margin-top: 15px; color: red;">
      {{ t('addressConverter.notAnAddress') }}
    </div>

    <div v-if="converted" style="margin-top: 15px;">
      <div v-if="isOwnAddress" style="margin-bottom: 12px; color: var(--color-primary);">
        {{ t('addressConverter.ownAddress') }}
      </div>

      <div class="converter-row">
        <div>{{ t('addressConverter.cashAddress') }}</div>
        <span class="converter-value" @click="copyToClipboard(converted.cashAddress)">
          {{ converted.cashAddress }}<img class="copyIcon" :src="copyIconSrc">
        </span>
      </div>

      <div class="converter-row">
        <div>{{ t('addressConverter.tokenAddress') }}</div>
        <span class="converter-value" @click="copyToClipboard(converted.tokenAddress)">
          {{ converted.tokenAddress }}<img class="copyIcon" :src="copyIconSrc">
        </span>
        <div class="converter-hint">{{ t('addressConverter.tokenWarning') }}</div>
      </div>

      <div class="converter-row">
        <div>{{ t('addressConverter.legacyAddress') }}</div>
        <template v-if="converted.legacyAddress">
          <span class="converter-value" @click="copyToClipboard(converted.legacyAddress)">
            {{ converted.legacyAddress }}<img class="copyIcon" :src="copyIconSrc">
          </span>
          <div class="converter-hint">{{ t('addressConverter.legacyWarning') }}</div>
        </template>
        <span v-else style="color: grey;">{{ t('addressConverter.none') }}</span>
      </div>

      <div class="converter-row">
        <div>{{ t('addressConverter.lockingBytecode') }}</div>
        <span class="converter-value" @click="copyToClipboard(converted.lockingBytecode)">
          {{ converted.lockingBytecode }}<img class="copyIcon" :src="copyIconSrc">
        </span>
      </div>

      <div class="converter-row">
        {{ t('addressConverter.type') }} {{ converted.type }}
      </div>
      <div class="converter-row">
        {{ t('addressConverter.network') }} {{ networkNames[converted.prefix] }}
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
.converter-row {
  margin-bottom: 12px;
}
.converter-value {
  font-family: monospace;
  word-break: break-all;
  cursor: pointer;
}
.converter-hint {
  font-size: smaller;
  color: grey;
  margin-top: 4px;
}
</style>
