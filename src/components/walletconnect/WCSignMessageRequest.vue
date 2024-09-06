<script setup lang="ts">
  import { toRefs } from 'vue';
  import { useDialogPluginComponent } from 'quasar'
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { useStore } from 'src/stores/store'
  const store = useStore()

  const props = defineProps<{
    dappMetadata: DappMetadata,
    signMessageRequestWC: any
  }>()
  const { signMessageRequestWC } = toRefs(props);

  defineEmits([
    ...useDialogPluginComponent.emits
  ])
  const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()
  
  const requestParams = signMessageRequestWC.value.params.request.params
  const signingAddress = requestParams?.address ?? requestParams?.account;
  const walletAddress = store.wallet?.address
  if(signingAddress !== walletAddress) onDialogCancel()

  const message = requestParams?.message;
  if(!message) onDialogCancel()

</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" persistent transition-show="scale" transition-hide="scale">
    <q-card>
      <fieldset class="dialogFieldsetSignMessage"> 
        <legend style="font-size: large;">Sign Message</legend>

        <div style="display: flex; justify-content: center; font-size: larger;  margin-top: 1rem;">
          Sign Message
        </div>

        <div style="font-size: large; margin-top: 1.5rem;">Origin:</div>
        <div style="display: flex;">
          <img :src="dappMetadata.icons[0]" style="display: flex; height: 55px; width: 55px;">
          <div style="margin-left: 10px;">
            <div>{{ dappMetadata.name }}</div>
            <a :href="dappMetadata.url">{{ dappMetadata.url }}</a>
          </div>
        </div>
        <hr>
        <div style="margin: 15px 0;">
          <div>Signer:</div>
          {{ signingAddress }}
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
    background-color: white
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