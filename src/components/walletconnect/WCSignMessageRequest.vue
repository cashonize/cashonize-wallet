<script setup lang="ts">
  import { toRefs } from 'vue';
  import { useDialogPluginComponent } from 'quasar'
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { type WalletKitTypes } from '@reown/walletkit'
  import { useStore } from 'src/stores/store'
  import { type WcSignMessageRequest } from '@bch-wc2/interfaces';
  const store = useStore()

  const props = defineProps<{
    dappMetadata: DappMetadata,
    signMessageRequestWC: WalletKitTypes.SessionRequest
  }>()
  const { signMessageRequestWC } = toRefs(props);

  defineEmits([
    ...useDialogPluginComponent.emits
  ])
  const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()
  
  const requestParams = signMessageRequestWC.value.params.request.params as WcSignMessageRequest
  const message = requestParams.message
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" persistent transition-show="scale" transition-hide="scale">
    <q-card>
      <fieldset class="dialogFieldsetSignMessage"> 
        <legend style="font-size: large;">Sign Message</legend>

        <div style="display: flex; justify-content: center; font-size: large;  margin-top: 1rem;">
          {{ requestParams.userPrompt ?? 'Sign Message' }}
        </div>

        <div style="font-size: large; margin-top: 1.5rem;">Origin:</div>
        <div style="display: flex;">
          <img :src="dappMetadata.icons[0] ?? ''" style="display: flex; height: 55px; width: 55px;">
          <div style="margin-left: 10px;">
            <div>{{ dappMetadata.name }}</div>
            <a :href="dappMetadata.url" target="_blank">{{ dappMetadata.url }}</a>
          </div>
        </div>
        <hr>
        <div style="margin: 15px 0;">
          <div>Signer:</div>
          {{ store.wallet.cashaddr }}
        </div>
        <div style="margin: 15px 0;">
          <div>Message:</div>
          {{ message }}
        </div>
        
        <hr>
        <div class="wc-modal-bottom-buttons">
          <input type="button" class="primaryButton" value="Sign" @click="onDialogOK">
          <input type="button" value="Cancel" @click="onDialogCancel">
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldsetSignMessage{
    padding: .5rem 2rem;
    max-height: 90vh;
    width: 500px;
    max-width: 100%;
    background-color: white;
    overflow-wrap: anywhere;
  }
  body.dark .dialogFieldsetSignMessage {
    background-color: #050a14;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }
  .wc-modal-bottom-buttons {
    display: flex;
    justify-content: center;
    margin-top: 2rem;
    margin-bottom: 2rem;
    gap: 10px;
  }
  .wc-modal-bottom-buttons > input {
    width: 111px;
  }
</style>