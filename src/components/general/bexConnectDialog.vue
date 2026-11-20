<script setup lang="ts">
  import { useDialogPluginComponent } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import type { DappMetadata } from 'src/interfaces/interfaces'

  const { t } = useI18n()

  defineProps<{
    origin: string
    address: string
    network: string
    dappMetadata: DappMetadata
  }>()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])
  const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" persistent transition-show="scale" transition-hide="scale">
    <q-card class="dialogCard">
      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">{{ t('dapp.browserConnect.title') }}</legend>

        <div style="font-size: large; margin-top: 1.5rem;">{{ t('dapp.browserConnect.app') }}</div>
        <div style="overflow-wrap: anywhere;">{{ dappMetadata.name }}</div>

        <div style="font-size: large; margin-top: 1.5rem;">{{ t('dapp.browserConnect.origin') }}</div>
        <div style="overflow-wrap: anywhere;">{{ origin }}</div>

        <div style="font-size: large; margin-top: 1.5rem;">{{ t('dapp.browserConnect.account') }}</div>
        <div class="mono" style="overflow-wrap: anywhere;">{{ address }}</div>

        <div style="font-size: large; margin-top: 1.5rem;">{{ t('dapp.browserConnect.network') }}</div>
        <div>{{ network }}</div>

        <p style="margin-top: 1.5rem;">{{ t('dapp.browserConnect.notice') }}</p>

        <div class="wc-modal-bottom-buttons">
          <input type="button" class="primaryButton" :value="t('dapp.browserConnect.connectButton')" @click="onDialogOK">
          <input type="button" :value="t('dapp.browserConnect.cancelButton')" @click="onDialogCancel">
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset {
    padding: .5rem 2rem;
    max-height: 90vh;
    width: 500px;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .wc-modal-bottom-buttons {
    display: flex;
    justify-content: center;
    margin-top: 2rem;
    margin-bottom: 2rem;
    gap: 10px;
  }
</style>
