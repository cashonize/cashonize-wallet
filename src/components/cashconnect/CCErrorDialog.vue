<script setup lang="ts">
import { useDialogPluginComponent } from 'quasar'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()

defineProps<{
  error: Error
}>()

defineEmits([
  ...useDialogPluginComponent.emits
])

const { dialogRef, onDialogHide, onDialogOK } = useDialogPluginComponent()
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card>
      <fieldset class="cc-modal-fieldset" style="width:1024px">
        <legend class="cc-modal-fieldset-legend">{{ t('cashConnect.error.title') }}</legend>

        <div v-if="error.message">{{ error.message }}</div>

        <template v-if="error.stack">
          <q-expansion-item :label="t('cashConnect.error.stackTrace')" class="q-mt-md">
            <pre class="cc-pre">{{ error.stack }}</pre>
            <pre v-if="error.cause" class="cc-pre">{{ error.cause }}</pre>
          </q-expansion-item>
        </template>

        <!-- Bottom Buttons -->
        <div style="margin-top: 2rem; display: flex; gap: 1rem;" class="justify-center">
          <input type="button" class="primaryButton" :value="t('cashConnect.error.okButton')" @click="onDialogOK" v-close-popup>
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset{
    padding: 3rem;
    width: 500px;
    max-width: 100%;
    height: 220px;
    background-color: white
  }
  body.dark .dialogFieldset {
    background-color: #050a14;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }
</style>
