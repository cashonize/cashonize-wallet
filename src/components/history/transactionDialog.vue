<script setup lang="ts">
  import { ref } from 'vue';
  import { useStore } from 'src/stores/store'
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore';
import { TransactionHistoryItem } from 'mainnet-js/dist/module/history/interface';
import { convert } from 'mainnet-js';
import { CurrencySymbols, TokenDataNFT } from 'src/interfaces/interfaces';
import DialogNftIcon from '../tokenItems/dialogNftIcon.vue';

  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()

  const showDialog = ref(true);

  const props = defineProps<{
    historyItem: TransactionHistoryItem,
    unit: string,
    bcmrRegistries: Record<string, any> | undefined,
  }>()

  const emit = defineEmits(['hide']);

  function copyToClipboard(copyText: string|undefined){
    if(!copyText) return
    navigator.clipboard.writeText(copyText);
    $q.notify({
      message: "Copied!",
      icon: 'info',
      timeout : 1000,
      color: "grey-6"
    })
  }

  const ourAddress = store.wallet?.cashaddr ?? "";
  const feeIncurrency = await convert(props.historyItem.fee, "sat", settingsStore.currency) || "< 0.00";
  const currencySymbol = CurrencySymbols[settingsStore.currency];
  const tokenMetadata = ref(undefined as undefined | any);
  const selectedTokenId = ref("");
  const selectedTokenCommitment = ref("");

  const loadTokenMetadata = async (tokenId: string, commitment: string | undefined) => {
    if (!store.bcmrRegistries?.[tokenId]) {
      $q.notify({
        message: "Unknown token",
        icon: 'info',
        timeout : 1000,
        color: "grey-6"
      });
      return;
    }

    selectedTokenId.value = tokenId;
    if (commitment === undefined) {
      tokenMetadata.value = store.bcmrRegistries[tokenId];
      return;
    }

    if (!store.bcmrRegistries[tokenId].nfts?.[commitment]) {
      tokenMetadata.value = {};
      await store.importRegistries([{tokenId, nfts: [{token: {tokenId, commitment}}]} as TokenDataNFT], true);
    }
    tokenMetadata.value = store.bcmrRegistries[tokenId].nfts?.[commitment];
    selectedTokenCommitment.value = commitment;
  }
</script>

<template>
  <q-dialog v-model="showDialog" transition-show="scale" transition-hide="scale" @hide="emit('hide')">
    <q-card>
      <div v-if="tokenMetadata && (tokenMetadata.uris?.image || tokenMetadata.uris?.icon)">
        <DialogNftIcon :srcNftImage="tokenMetadata.uris?.image ? tokenMetadata.uris?.image : tokenMetadata.uris?.icon" :nftName="tokenMetadata.name" :token-id="selectedTokenId" :commitment="selectedTokenCommitment" @close-dialog="() => tokenMetadata = undefined"/>
      </div>

      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">Transaction</legend>

        <div style="display: flex; flex-direction: column; gap: 1rem">
          <div class="break">
            Transaction ID: 
            <a :href="store.explorerUrl + `/${historyItem.hash}`" target="_blank">{{ historyItem.hash.slice(0, 12) + "..." + historyItem.hash.slice(52) }}</a>
            <span @click="() => copyToClipboard(historyItem.hash)" style="cursor:pointer;">
              <img class="copyIcon" src="images/copyGrey.svg">
            </span>
          </div>
          <div>
            Status: 
              <span v-if="historyItem.timestamp === undefined">unconfirmed</span>
              <span v-else>{{ store.currentBlockHeight - historyItem.blockHeight }} confirmations
                ( Mined in block: {{ historyItem.blockHeight }} )
              </span>
          </div>
          <div v-if="historyItem.timestamp">
            Date: 
              <span>{{ new Date(historyItem.timestamp * 1000).toLocaleString() }}</span>
          </div>
          <div>
            Balance change: 
              <span>{{ historyItem.valueChange }} {{ unit }}</span>
          </div>
          <div>
            Size: 
              <span>{{ historyItem.size }} bytes</span>
          </div>
          <div>
            Fee: 
              <span>{{ feeIncurrency }}{{ currencySymbol }} or {{ historyItem.fee }} sat ( {{ (historyItem.fee / historyItem.size).toFixed(1) }} sat/byte )</span>
          </div>
        </div>

        <fieldset style="max-height: 200px; overflow: scroll; margin-top: 1rem;">
          <legend style="font-size: medium;">Inputs</legend>
          <div v-for="(input, index) in historyItem.inputs" :key="index" class="input" :class="settingsStore.darkMode ? 'dark' : ''">
            <span>{{ index }}: </span>
            <span class="break" :class="input.address === ourAddress ? 'our' : ''">{{ input.address.split(":")[1] }}</span>
            <div>
              <span v-if="!input.token">{{ input.value }} {{ unit }}</span>
              <span v-if="input.token" @click="loadTokenMetadata(input.token!.tokenId, input.token!.commitment!)" style="cursor: pointer; text-decoration-line: underline;">
                <span> {{ " " + (input.token.amount === 0n ? 1 : input.token.amount) }}</span>
                <span> {{ " " + (bcmrRegistries?.[input.token.tokenId]?.token?.symbol ?? input.token.tokenId.slice(0, 8)) }}</span>
                <span v-if="input.token.capability"> NFT</span>
                <img v-if="bcmrRegistries?.[input.token.tokenId]" style="margin-left: 0.5rem; width: 16px; height: 16px; border-radius: 50%;" :src="store.tokenIconUrl(input.token.tokenId)">
              </span>
            </div>
          </div>
        </fieldset>

        <fieldset style="max-height: 200px; overflow: scroll; margin-top: 1rem;">
          <legend style="font-size: medium;">Outputs</legend>
          <div v-for="(output, index) in historyItem.outputs" :key="index" class="output" :class="settingsStore.darkMode ? 'dark' : ''">
            <span v-if="output.value === 0" class="break">{{ index }}: {{ output.address }}</span>
            <span v-else>{{ index }}: <span class="break" :class="output.address === ourAddress ? 'our' : ''">{{ output.address.split(":")[1] }}</span></span>
            <div>
              <span v-if="!output.token && !output.address.includes('OP_RETURN')">{{ output.value }} {{ unit }}</span>
              <span v-if="output.token" @click="loadTokenMetadata(output.token!.tokenId, output.token!.commitment!)" style="cursor: pointer; text-decoration-line: underline;">
                <span> {{ " " + (output.token.amount === 0n ? 1 : output.token.amount) }}</span>
                <span> {{ " " + (bcmrRegistries?.[output.token.tokenId]?.token?.symbol ?? output.token.tokenId.slice(0, 8)) }}</span>
                <span v-if="output.token.capability"> NFT</span>
                <img v-if="bcmrRegistries?.[output.token.tokenId]" style="margin-left: 0.5rem; width: 16px; height: 16px; border-radius: 50%;" :src="store.tokenIconUrl(output.token.tokenId)">
              </span>
            </div>
          </div>
        </fieldset>

      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset{
    padding: 3rem;
    width: 500px;
    max-width: 100%;
    /* height: 220px; */
    background-color: white
  }
  body.dark .dialogFieldset {
    background-color: #050a14;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }
  .input:nth-child(odd) {
    background-color: var(--color-background-soft);
  }
  .output:nth-child(odd) {
    background-color: var(--color-background-soft);
  }
  .input.dark:nth-child(odd) {
    background-color: #232326;
  }
  .output.dark:nth-child(odd) {
    background-color: #232326;
  }
  .our{
    text-decoration-line: underline;
  }
  .break {
    word-break: break-all;
  }
</style>