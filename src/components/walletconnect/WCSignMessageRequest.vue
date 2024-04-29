<script setup lang="ts">
  import { ref, toRefs } from 'vue';
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { getSdkError } from '@walletconnect/utils';
  import { useStore } from 'src/stores/store'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  const store = useStore()
  const walletconnectStore = useWalletconnectStore()
  const web3wallet = walletconnectStore.web3wallet
  const emit = defineEmits(['signMessage', 'rejectSignMessage']);

  const showDialog = ref(true);

  const props = defineProps<{
    dappMetadata: DappMetadata,
    signMessageRequestWC: any
  }>()
  const { signMessageRequestWC } = toRefs(props);

  const { id, topic } = signMessageRequestWC.value;
  
  const requestParams = signMessageRequestWC.value.params.request.params
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
  }
  async function rejectSignMessage(){
    const response = { id, jsonrpc: '2.0', error: getSdkError('USER_REJECTED') };
    await web3wallet?.respondSessionRequest({ topic, response });
    emit('rejectSignMessage')
  }
</script>

<template>
  <q-dialog v-model="showDialog" persistent transition-show="scale" transition-hide="scale">
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
  .q-dialog__backdrop {
    backdrop-filter: blur(24px);
    background-color: transparent;
    pointer-events: all  !important;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }
</style>