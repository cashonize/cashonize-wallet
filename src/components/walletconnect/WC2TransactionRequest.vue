<script setup lang="ts">
  import { ref, toRefs } from 'vue';
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { useStore } from 'src/stores/store'
  const store = useStore()
  // const emit = defineEmits(['signTransactionWC']);

  const showDialog = ref(true);

  const props = defineProps<{
    dappMetadata: DappMetadata,
    transactionRequestWC: any
  }>()
  const { transactionRequestWC } = toRefs(props);

  const requestParams = transactionRequestWC.value.params.request.params;

  function signWCtransaction() {
    // emit('signTransactionWC', );
  }
</script>

<template>
  <q-dialog v-model="showDialog" persistent transition-show="scale" transition-hide="scale">
    <q-card>
      <fieldset class="dialogFieldset"> 
        <legend style="font-size: large;">Sign Transaction</legend>
        <div style="display: flex; justify-content: center; font-size: larger;"> {{ requestParams.userPrompt }}</div>
        <div style="font-size: large; margin-top: 2rem;">Origin:</div>
        <div style="display: flex;">
          <img :src="dappMetadata.icons[0]" style="display: flex; height: 55px; width: 55px;">
          <div style="margin-left: 10px;">
            <div>{{ dappMetadata.name }}</div>
            <a :href="dappMetadata.url">{{ dappMetadata.url }}</a>
          </div>
        </div>
        <div style="font-size: large; margin-top: 2rem;">Signer:</div>
        <div style="font-size: smaller;">{{ store.wallet?.getDepositAddress() }}</div>
        <div style="font-size: large; margin-top: 2rem;">Inputs:</div>
        <div style="font-size: large; margin-top: 2rem;">Outputs:</div>
        <div style="margin-top: 2rem; display: flex; gap: 1rem;">
          <input type="button" class="primaryButton" value="Sign" @click="() => signWCtransaction()" v-close-popup>
          <input type="button" value="Cancel" v-close-popup>
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style>
  .dialogFieldset{
    padding: .5rem 2rem;
    width: 500px;
    height: 600px;
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