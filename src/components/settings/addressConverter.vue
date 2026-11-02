<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import { copyToClipboard } from 'src/utils/utils'
  import { convertAddress } from 'src/utils/tools/addressConverter'
  import InfoPopup from 'src/components/general/InfoPopup.vue'

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

    <div>
      {{ t('addressConverter.description') }}
      <InfoPopup>
        <div>{{ t('addressConverter.formsInfo') }}</div>
      </InfoPopup>
    </div>

    <input
      v-model="addressInput"
      type="text"
      :placeholder="t('addressConverter.inputPlaceholder')"
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
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
        {{ t('addressConverter.cashAddress') }}
        <span class="converter-copy" @click="copyToClipboard(converted.cashAddress)">
          <span class="depositAddr">{{ converted.cashAddress }}</span> <img class="copyIcon" :src="copyIconSrc">
        </span>
      </div>

      <div class="converter-row">
        {{ t('addressConverter.tokenAddress') }}
        <span class="converter-copy" @click="copyToClipboard(converted.tokenAddress)">
          <span class="depositAddr">{{ converted.tokenAddress }}</span> <img class="copyIcon" :src="copyIconSrc">
        </span>
        <div class="converter-hint">{{ t('addressConverter.tokenWarning') }}</div>
      </div>

      <div class="converter-row">
        {{ t('addressConverter.legacyAddress') }}
        <template v-if="converted.legacyAddress">
          <span class="converter-copy" @click="copyToClipboard(converted.legacyAddress)">
            <span class="depositAddr">{{ converted.legacyAddress }}</span> <img class="copyIcon" :src="copyIconSrc">
          </span>
          <div class="converter-hint">{{ t('addressConverter.legacyWarning') }}</div>
        </template>
        <span v-else style="color: grey;">{{ t('addressConverter.none') }}</span>
      </div>

      <div class="converter-row">
        {{ t('addressConverter.lockingBytecode') }}
        <span class="converter-copy" @click="copyToClipboard(converted.lockingBytecode)">
          <span class="depositAddr">{{ converted.lockingBytecode }}</span> <img class="copyIcon" :src="copyIconSrc">
        </span>
      </div>

      <div class="converter-row">
        {{ t('addressConverter.type') }} {{ converted.type }}
      </div>
      <div class="converter-row">
        {{ t('addressConverter.network') }} {{ networkNames[converted.prefix] }}
        <span v-if="converted.networkAssumed" style="color: grey;">{{ t('addressConverter.activeNetworkNote') }}</span>
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
.converter-row {
  margin-bottom: 12px;
}
.converter-copy {
  cursor: pointer;
}
.converter-hint {
  font-size: smaller;
  color: grey;
  margin-top: 2px;
}
</style>
