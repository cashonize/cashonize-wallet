<script setup lang="ts">
import { useDialogPluginComponent } from 'quasar'
import type { CashRPCError } from 'cashconnect';
import type { Web3WalletTypes } from '@walletconnect/web3wallet';

const props = defineProps<{
  error: CashRPCError
}>()

defineEmits([
  // REQUIRED; need to specify some events that your
  // component will emit through useDialogPluginComponent()
  ...useDialogPluginComponent.emits
])

const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

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
        <legend class="cc-modal-fieldset-legend">Error</legend>

        <div v-if="error.message">{{ error.message }}</div>

        <template v-if="error.stackTrace">
          <div>Stack Trace:</div>
          <pre class="cc-pre">{{ error.stackTrace }}</pre>
        </template>

        <!-- Bottom Buttons -->
        <div class="cc-modal-bottom-buttons">
          <q-btn color="primary" label="OK" @click="onOKClick" />
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
