<script setup lang="ts">
  // Why a dapp request was refused, in full: shown in strict validation mode, the developer
  // setting for testing a dapp, where a toast would hide the reason (see utils/dapp/invalidRequest.ts)
  import { useDialogPluginComponent } from 'quasar'
  import { useI18n } from 'vue-i18n'
  const { t } = useI18n()

  defineProps<{
    message: string,
    details: string,
  }>()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])

  const { dialogRef, onDialogHide, onDialogOK } = useDialogPluginComponent()
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card class="dialogCard">
      <fieldset class="cc-modal-fieldset">
        <legend class="cc-modal-fieldset-legend">{{ t('dappRequestError.title') }}</legend>
        <div>{{ message }}</div>
        <pre class="cc-pre q-mt-md">{{ details }}</pre>
        <div style="margin-top: 1.5rem; display: flex;" class="justify-center">
          <input type="button" class="primaryButton" :value="t('dappRequestError.okButton')" @click="onDialogOK" v-close-popup>
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>
