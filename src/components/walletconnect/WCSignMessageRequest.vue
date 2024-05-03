<script setup lang="ts">
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { getSdkError } from '@walletconnect/utils';
  import { useStore } from 'src/stores/store'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  const store = useStore()
  const walletconnectStore = useWalletconnectStore()
  const web3wallet = walletconnectStore.web3wallet
  const emit = defineEmits(['signMessage', 'rejectSignMessage']);

  const props = defineProps<{
    dappMetadata: DappMetadata,
    signMessageRequestWC: any,
    onDialogHide: () => void,
    onDialogOK: (payload?: any) => void,
    onDialogCancel: () => void,
  }>()

  const { id, topic } = props.signMessageRequestWC;
  const requestParams = props.signMessageRequestWC.params.request.params
  const signingAddress = requestParams?.address ?? requestParams?.account;
  const walletAddress = store.wallet?.address
  if(signingAddress !== walletAddress)  rejectSignMessage()

  const message = requestParams?.message;
  if(!message) rejectSignMessage()

  async function signMessage(){
    const signedMessage = await store.wallet?.sign(message);
    const response = { id, jsonrpc: '2.0', result: signedMessage?.signature };
    await web3wallet?.respondSessionRequest({ topic, response });
    emit('signMessage')
    props.onDialogCancel()
  }
  async function rejectSignMessage(){
    const response = { id, jsonrpc: '2.0', error: getSdkError('USER_REJECTED') };
    await web3wallet?.respondSessionRequest({ topic, response });
    emit('rejectSignMessage')
    props.onDialogCancel()
  }
</script>

<template>
    <q-card>
      <fieldset class="dialogFieldsetSignMessage"> 
        <legend style="font-size: large;">Sign Message</legend>
        <div style="display: flex;">
          <img :src="dappMetadata.icons[0]" style="display: flex; height: 55px; width: 55px;">
          <div style="margin-left: 10px;">
            <div>{{ dappMetadata.name }}</div>
            <a :href="dappMetadata.url">{{ dappMetadata.url }}</a>
          </div>
        </div>
        <hr>
        <div style="display: flex; justify-content: center; font-size: larger;">Sign Message </div>
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
            <input type="button" class="primaryButton" value="Sign" @click="() => signMessage()" v-close-popup>
            <input type="button" value="Cancel" @click="() => rejectSignMessage()" v-close-popup>
          </div>
      </fieldset>
    </q-card>
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
</style>