<script setup lang="ts">
  import { useDialogPluginComponent } from 'quasar'
  import HdAddressSelect from 'src/components/walletconnect/hdAddressSelect.vue'

  defineProps<{
    title: string,
    hint: string,
  }>()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])

  const { dialogRef, onDialogHide, onDialogOK } = useDialogPluginComponent()

  // Picking an address applies it right away, no separate confirm step
  function onSelectionChanged(addresses: string[]) {
    const selectedAddress = addresses[0];
    if (selectedAddress) onDialogOK(selectedAddress);
  }
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" transition-show="scale" transition-hide="scale">
    <q-card class="dialogCard">
      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">{{ title }}</legend>
        <div style="max-height: 350px; overflow-y: auto; overflow-x: hidden;">
          <HdAddressSelect :hint="hint" @selection-changed="onSelectionChanged" />
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset{
    padding: 2rem;
    width: 550px;
    max-width: 100%;
  }
</style>
