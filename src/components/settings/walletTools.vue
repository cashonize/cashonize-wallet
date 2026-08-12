<script setup lang="ts">
  import { computed } from 'vue'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  // Highlights token utxos holding significant bch, same check as the settings menu entry
  const utxosWithBchAndTokens = computed(() => {
    return store.walletUtxos?.filter(utxo => utxo.token?.category && utxo.satoshis > 100_000n);
  });
</script>

<template>
  <fieldset class="item">
    <legend>{{ t('settings.menu.tools') }}</legend>

    <div style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(7)">
      → {{ t('settings.menu.utxoManagement') }} <span v-if="utxosWithBchAndTokens?.length" style="color: orange">{{ t('settings.menu.important') }}</span>
    </div>

    <div style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(8)">
      → {{ t('settings.menu.sweepPrivateKey') }}
    </div>

    <div style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(13)">
      → {{ t('settings.menu.signVerifyMessage') }}
    </div>

    <div v-if="settingsStore.getWalletType(store.activeWalletName) === 'hd'" style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(15)">
      → {{ t('settings.menu.exportXpub') }}
    </div>
  </fieldset>
</template>
