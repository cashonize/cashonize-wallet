<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { HDWallet } from 'mainnet-js'
  import { useStore } from 'src/stores/store'
  import { useI18n } from 'vue-i18n'
  import { copyToClipboard } from 'src/utils/utils'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import QrCode from 'src/components/general/qrCode.vue'

  const store = useStore()
  const { t } = useI18n()

  const revealed = ref(false);

  // wallet can briefly be non-HD mid wallet-switch, the KeepAlive-cached view guards itself
  const hdWallet = computed(() => store._wallet instanceof HDWallet ? store._wallet : undefined);
  const xpub = computed(() => hdWallet.value?.xPub);
  const derivationPath = computed(() => hdWallet.value?.derivation);

  // Hide the xpub again when the user switches wallets or networks
  watch(() => store._wallet, () => {
    revealed.value = false;
  });
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('exportXpub.title') }}</legend>

    <div>
      {{ t('exportXpub.description') }}
      <InfoPopup>
        <div style="max-width: 300px;">{{ t('exportXpub.usageHint') }}</div>
        <div class="info-popup-note" style="max-width: 300px;">{{ t('exportXpub.usageHintNote') }}</div>
      </InfoPopup>
    </div>

    <div class="warning-box" style="margin-top: 15px;">
      <q-icon name="warning" size="20px" class="warning-box-icon" />
      <div><b>{{ t('common.attention') }}</b> {{ t('exportXpub.privacyWarning') }}</div>
    </div>

    <div v-if="!revealed" style="margin-top: 15px;">
      <input @click="revealed = true" type="button" class="primaryButton" :value="t('exportXpub.revealButton')">
    </div>
    <div v-else-if="xpub" style="margin-top: 15px;">
      <div style="margin-bottom: 15px;">
        {{ t('exportXpub.derivationPath') }} <span style="font-family: monospace;">{{ derivationPath }}</span>
      </div>
      <div class="qr-frame" style="margin: 0 auto 15px;">
        <QrCode :contents="xpub" class="qr-code" @click="copyToClipboard(xpub)" />
      </div>
      <div class="xpub-result" @click="copyToClipboard(xpub)">{{ xpub }}</div>
      <div class="xpub-button-row">
        <input @click="copyToClipboard(xpub)" type="button" class="button" :value="t('exportXpub.copyButton')">
        <input @click="revealed = false" type="button" class="button" :value="t('exportXpub.hideButton')">
      </div>
      <div style="font-size: smaller; color: grey; margin-top: 8px;">
        {{ t('exportXpub.safetyHint') }}
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
.xpub-result {
  border: 1px solid rgba(128, 128, 128, 0.2);
  background-color: rgba(128, 128, 128, 0.06);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: monospace;
  word-break: break-all;
  cursor: pointer;
}
.xpub-button-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 12px;
  flex-wrap: wrap;
}
</style>
