<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { useStore } from 'src/stores/store'
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useWindowSize } from '@vueuse/core'
  import { convert, type TransactionHistoryItem } from 'mainnet-js';
  import { type BcmrNftMetadata, type BcmrTokenMetadata, CurrencySymbols, type TokenDataNFT } from 'src/interfaces/interfaces';
  import DialogNftIcon from '../tokenItems/dialogNftIcon.vue';
  import TokenIcon from '../general/TokenIcon.vue';
  import { formatTimestamp, formatRelativeTime, satsToBch } from 'src/utils/utils';

  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()

  const { width } = useWindowSize();
  const isMobilePhone = computed(() => width.value < 480)

  const showDialog = ref(true);

  const props = defineProps<{
    historyItem: TransactionHistoryItem,
  }>();
  const isCoinbase = computed(() => props.historyItem.inputs[0]?.address === "coinbase");

  const emit = defineEmits(['hide']);

  function copyToClipboard(copyText: string|undefined){
    if(!copyText) return
    void navigator.clipboard.writeText(copyText);
    $q.notify({
      message: "Copied!",
      icon: 'info',
      timeout : 1000,
      color: "grey-6"
    })
  }

  const tokenMetadata = ref(undefined as undefined | BcmrTokenMetadata | BcmrNftMetadata);
  const selectedTokenId = ref("");
  const selectedTokenCommitment = ref("");

  const bchDisplayUnit = computed(() => {
    return store.network === "mainnet" ? "BCH" : "tBCH";
  });

  const ourAddress = store.wallet.cashaddr ?? "";
  const feeIncurrency = await convert(props.historyItem.fee, "sat", settingsStore.currency) || "< 0.00";
  const currencySymbol = CurrencySymbols[settingsStore.currency];

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
      await store.fetchTokenMetadata([{tokenId, nfts: [{token: {tokenId, commitment}}]} as TokenDataNFT], true);
    }
    tokenMetadata.value = store.bcmrRegistries[tokenId].nfts?.[commitment];
    selectedTokenCommitment.value = commitment;
  }
</script>

<template>
  <q-dialog v-model="showDialog" transition-show="scale" transition-hide="scale" @hide="emit('hide')">
    <q-card>
      <div v-if="tokenMetadata && (tokenMetadata.uris?.image || tokenMetadata.uris?.icon)">
        <DialogNftIcon
          :srcNftImage="tokenMetadata.uris?.image ? tokenMetadata.uris.image : (tokenMetadata.uris.icon as string)"
          :nftName="tokenMetadata.name"
          :token-id="selectedTokenId"
          :commitment="selectedTokenCommitment"
          @close-dialog="() => tokenMetadata = undefined"
        />
      </div>

      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">Transaction</legend>

        <div style="display: flex; flex-direction: column; gap: 1rem">
          <div>
            {{ isMobilePhone? 'TxId: ' : 'Transaction ID: ' }}
            <span :href="store.explorerUrl + `/${historyItem.hash}`" @click="() => copyToClipboard(historyItem.hash)" style="cursor:pointer; color: var(--color-grey);">
              {{ historyItem.hash.slice(0, 12) + "..." + historyItem.hash.slice(52) }}
            </span>
            <span @click="() => copyToClipboard(historyItem.hash)" style="cursor:pointer;">
              <img class="copyIcon" src="images/copyGrey.svg">
            </span>
          </div>
          <div>
            <a :href="store.explorerUrl + `/${historyItem.hash}`" target="_blank" style="display: inline-block;">
              Link to BlockExplorer
            </a>
            <span @click="() => copyToClipboard(store.explorerUrl + `/${historyItem.hash}`)" style="cursor:pointer;">
              <img class="copyIcon" src="images/copyGrey.svg" style="vertical-align: text-bottom;">
            </span>
          </div>
          <div>
            Status:
              <span v-if="historyItem.timestamp === undefined">unconfirmed</span>
              <span v-else>{{ store.currentBlockHeight as number - historyItem.blockHeight }} confirmations
                (mined in block #{{ historyItem.blockHeight.toLocaleString("en-US") }})
              </span>
          </div>
          <div v-if="historyItem.timestamp">
            Date:
              <span>{{ formatTimestamp(historyItem.timestamp, settingsStore.dateFormat) }} ({{ formatRelativeTime(historyItem.timestamp) }})</span>
          </div>
          <div>
            Balance change:
              <span>{{ satsToBch(historyItem.valueChange) }} {{ bchDisplayUnit }}</span>
          </div>
          <div>
            Size:
              <span>{{ historyItem.size.toLocaleString("en-US") }} bytes</span>
          </div>
          <div v-if="!isCoinbase">
            Fee:
              <span>{{ feeIncurrency }}{{ currencySymbol }} or {{ historyItem.fee.toLocaleString("en-US") }} sat ({{ (historyItem.fee / historyItem.size).toFixed(1) }} sat/byte)</span>
          </div>
          <div v-else>
            Fees collected:
              <span>{{ feeIncurrency }}{{ currencySymbol }} or {{ historyItem.fee.toLocaleString("en-US") }} sat</span>
          </div>
        </div>

        <fieldset style="max-height: 200px; overflow: scroll; margin-top: 1rem;">
          <legend style="font-size: medium;">Inputs</legend>
          <div v-for="(input, index) in historyItem.inputs" :key="index" class="input" :class="settingsStore.darkMode ? 'dark' : ''">
            <span>{{ index }}: </span>
            <span class="break" :class="input.address === ourAddress ? 'thisWalletTag' : ''">{{ isCoinbase ? "coinbase" : input.address.split(":")[1] }}</span>
            <div style="margin-left: 25px;">
              <div v-if="input.value > 10_000">{{ satsToBch(input.value) }} {{ bchDisplayUnit }}</div>
              <span v-if="input.token" @click="loadTokenMetadata(input.token!.tokenId, input.token!.commitment!)" style="cursor: pointer;">
                <span> {{ " " + (input.token.amount === 0n ? 1 : Number(input.token.amount) / 10**(store.bcmrRegistries?.[input.token.tokenId]?.token.decimals ?? 0)) }}</span>
                <span> {{ " " + (store.bcmrRegistries?.[input.token.tokenId]?.token?.symbol ?? input.token.tokenId.slice(0, 8)) }}</span>
                <span v-if="input.token.capability"> NFT</span>
                <TokenIcon
                  style="margin-left: 0.5rem; vertical-align: sub;"
                  :token-id="input.token.tokenId"
                  :icon-url="store.tokenIconUrl(input.token.tokenId)"
                  :size="20"
                />
              </span>
            </div>
          </div>
        </fieldset>

        <fieldset style="max-height: 200px; overflow: scroll; margin-top: 1rem;">
          <legend style="font-size: medium;">Outputs</legend>
          <div v-for="(output, index) in historyItem.outputs" :key="index" class="output" :class="settingsStore.darkMode ? 'dark' : ''">
            <span v-if="output.value === 0" class="break">{{ index }}: {{ output.address }}</span>
            <span v-else>{{ index }}: <span class="break" :class="output.address === ourAddress ? 'thisWalletTag' : ''">{{ output.address.split(":")[1] }}</span></span>
            <div style="margin-left: 25px;">
              <div v-if="output.value > 10_000">{{ satsToBch(output.value) }} {{ bchDisplayUnit }}</div>
              <span v-if="output.token" @click="loadTokenMetadata(output.token!.tokenId, output.token!.commitment!)" style="cursor: pointer;">
                <span> {{ " " + (output.token.amount === 0n ? 1 : Number(output.token.amount) / 10**(store.bcmrRegistries?.[output.token.tokenId]?.token.decimals ?? 0)) }}</span>
                <span> {{ " " + (store.bcmrRegistries?.[output.token.tokenId]?.token?.symbol ?? output.token.tokenId.slice(0, 8)) }}</span>
                <span v-if="output.token.capability"> NFT</span>
                <TokenIcon
                  style="margin-left: 0.5rem; vertical-align: sub;"
                  :token-id="output.token.tokenId"
                  :icon-url="store.tokenIconUrl(output.token.tokenId)"
                  :size="20"
                />
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
  .break {
    word-break: break-all;
  }
  .thisWalletTag{
    color: hsla(160, 100%, 37%, 1)
  }

  @media only screen and (max-width: 450px) {
    .dialogFieldset{
      padding: 2rem; 
    }
  }
</style>