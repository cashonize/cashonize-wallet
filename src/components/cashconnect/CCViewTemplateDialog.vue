<script setup lang="ts">
import { useDialogPluginComponent } from 'quasar'

defineProps<{
  template: string
}>()

defineEmits([
  ...useDialogPluginComponent.emits
])

const { dialogRef, onDialogHide, onDialogOK } = useDialogPluginComponent()
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card>
      <fieldset class="cc-modal-fieldset">
        <legend class="cc-modal-fieldset-legend">Template</legend>

        <pre style="font-size: 10px;">{{ template }}</pre>

        <!-- Bottom Buttons -->
        <div style="margin-top: 2rem; display: flex; gap: 1rem;" class="justify-center">
          <input type="button" class="primaryButton" value="Close" @click="onDialogOK" v-close-popup>
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldsetSignMessage{
    padding: 3rem;
    max-height: 90vh;
    width: 500px;
    max-width: 100%;
    background-color: white
  }
  body.dark .dialogFieldsetSignMessage {
    background-color: #050a14;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }

  pre {
    width: 450px;
    max-width: 100%;
    white-space: pre-wrap; /* Allows wrapping */
    word-wrap: break-word; /* Breaks long words */
    overflow: auto; /* Adds scrollbars if necessary */
  }
</style>
