<script setup lang="ts">
  import { useDialogPluginComponent } from 'quasar'
  import { useI18n } from 'vue-i18n'
  const { t } = useI18n()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])

  const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" persistent transition-show="scale" transition-hide="scale">
    <q-card>
      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">{{ t('wizardConnect.pairing.title') }}</legend>
        <div>{{ t('wizardConnect.pairing.intro') }}</div>
        <ul class="pairing-bullets">
          <li>{{ t('wizardConnect.pairing.bulletHistory') }}</li>
          <li>{{ t('wizardConnect.pairing.bulletPrivacy') }}</li>
          <li>{{ t('wizardConnect.pairing.bulletSpending') }}</li>
        </ul>
        <!-- The pairing URI carries no dapp metadata, so unlike the other connection
             methods there is no dapp name or icon to show before connecting -->
        <div class="pairing-note">{{ t('wizardConnect.pairing.dappInfoNote') }}</div>
        <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
          <input type="button" class="primaryButton" :value="t('wizardConnect.pairing.connectButton')" @click="onDialogOK" v-close-popup>
          <input type="button" :value="t('wizardConnect.pairing.cancelButton')" @click="onDialogCancel">
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset{
    padding: 2rem 3rem;
    width: 500px;
    max-width: 100%;
    background-color: white;
  }
  body.dark .dialogFieldset {
    background-color: #050a14;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }
  .pairing-bullets {
    margin: 1rem 0;
    padding-left: 1.25rem;
  }
  .pairing-bullets li {
    margin-bottom: 0.5rem;
  }
  .pairing-note {
    font-size: smaller;
    color: var(--color-grey);
  }
</style>
