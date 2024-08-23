<script setup lang="ts">
import { useDialogPluginComponent } from 'quasar'

defineProps<{
  template: string
}>()

defineEmits([
  // REQUIRED; need to specify some events that your
  // component will emit through useDialogPluginComponent()
  ...useDialogPluginComponent.emits
])

const { dialogRef, onDialogHide, onDialogOK } = useDialogPluginComponent()

// this is part of our example (so not required)
function onOKClick () {
  // on OK, it is REQUIRED to
  // call onDialogOK (with optional payload)
  onDialogOK()
  // or with payload: onDialogOK({ ... })
  // ...and it will also hide the dialog automatically
}
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card>
      <fieldset class="cc-modal-fieldset" style="width:1024px">
        <legend class="cc-modal-fieldset-legend">Template</legend>

        <div class="scroll">
          <pre style="font-size: 10px;">{{ template }}</pre>
        </div>

        <!-- Bottom Buttons -->
        <div class="cc-modal-bottom-buttons">
          <q-btn color="primary" label="OK" @click="onOKClick" />
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>
