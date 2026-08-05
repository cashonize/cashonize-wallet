<script setup lang="ts">
  import { computed, ref, watch, onUnmounted } from 'vue';
  import { useStore } from 'src/stores/store'
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useWindowSize } from 'src/utils/composables'
  import { convert, type TransactionHistoryItem } from 'mainnet-js';
  import { type BcmrNftMetadata, type BcmrTokenMetadata, CurrencySymbols } from 'src/interfaces/interfaces';
  import DialogNftIcon from '../tokenItems/dialogNftIcon.vue';
  import TokenIcon from '../general/TokenIcon.vue';
  import { formatTime, formatRelativeTime, satsToBch, formatBchAmount, formatFiatAmount, tokenChangeChips } from 'src/utils/utils';
  import { maxTxNoteLength } from 'src/utils/txNotes';
  import { useI18n } from 'vue-i18n'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()
  const { t } = useI18n()

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
      message: t('transactionDialog.copied'),
      icon: 'info',
      timeout : 1000,
      color: "grey-6"
    })
  }

  // The note field autosaves: debounced while typing, immediately on blur and on dialog close
  const noteDraft = ref(store.txNotes[props.historyItem.hash] ?? "");
  let noteSaveTimeout: ReturnType<typeof setTimeout> | undefined;

  function saveNote() {
    clearTimeout(noteSaveTimeout);
    store.setTxNote(props.historyItem.hash, noteDraft.value);
  }

  watch(noteDraft, () => {
    clearTimeout(noteSaveTimeout);
    noteSaveTimeout = setTimeout(saveNote, 500);
  });
  onUnmounted(saveNote);

  const tokenMetadata = ref(undefined as undefined | BcmrTokenMetadata | BcmrNftMetadata);
  const selectedTokenId = ref("");
  const selectedTokenCommitment = ref("");

  const bchDisplayUnit = computed(() => {
    return store.network === "mainnet" ? "BCH" : "tBCH";
  });

  // Easily readable date like "1 Aug 2026, 23:48"
  function formatReadableDate(timestamp: number): string {
    const day = new Date(timestamp * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return `${day}, ${formatTime(timestamp)}`;
  }

  function formatTokenAmount(amount: bigint, category: string) {
    const decimals = store.bcmrRegistries?.[category]?.token.decimals ?? 0;
    const value = Number(amount) / 10 ** decimals;
    return value.toLocaleString("en-US", { maximumFractionDigits: decimals });
  }

  // The fiat fee is cosmetic here (unlike the dapp signing dialogs), so a failed rate
  // fetch falls back to the last known rate and never blocks opening the dialog
  // The '|| "< 0.005"' handles a zero result: both paths round to 2 decimals, so 0 means the real value is below 0.005
  let feeIncurrency: string | number | undefined;
  try {
    feeIncurrency = await convert(props.historyItem.fee, "sat", settingsStore.currency) || "< 0.005";
  } catch {
    if (store.exchangeRate !== undefined) {
      feeIncurrency = Number((satsToBch(props.historyItem.fee) * store.exchangeRate).toFixed(2)) || "< 0.005";
    }
  }
  const currencySymbol = CurrencySymbols[settingsStore.currency];

  const loadTokenMetadata = async (category: string, commitment: string | undefined) => {
    if (!store.bcmrRegistries?.[category]) {
      $q.notify({
        message: t('transactionDialog.unknownToken'),
        icon: 'info',
        timeout : 1000,
        color: "grey-6"
      });
      return;
    }

    selectedTokenId.value = category;
    if (commitment === undefined) {
      tokenMetadata.value = store.bcmrRegistries[category];
      return;
    }

    if (!store.bcmrRegistries[category].nfts?.[commitment]) {
      await store.fetchNftMetadata(category, commitment);
    }
    tokenMetadata.value = store.bcmrRegistries[category].nfts?.[commitment];
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
        <legend style="font-size: large;">{{ t('transactionDialog.title') }}</legend>

        <div style="display: flex; flex-direction: column; gap: 1rem">
          <div>
            {{ isMobilePhone? t('transactionDialog.txIdShort') : t('transactionDialog.txIdFull') }}
            <span :href="store.explorerUrl + `/${historyItem.hash}`" @click="() => copyToClipboard(historyItem.hash)" style="cursor:pointer; color: var(--color-grey);">
              {{ historyItem.hash.slice(0, 12) + "..." + historyItem.hash.slice(52) }}
            </span>
            <span @click="() => copyToClipboard(historyItem.hash)" style="cursor:pointer;">
              <img class="copyIcon" src="images/copyGrey.svg">
            </span>
          </div>
          <div>
            <a :href="store.explorerUrl + `/${historyItem.hash}`" target="_blank" style="display: inline-block;">
              {{ t('transactionDialog.linkToExplorer') }}
            </a>
            <span @click="() => copyToClipboard(store.explorerUrl + `/${historyItem.hash}`)" style="cursor:pointer;">
              <img class="copyIcon" src="images/copyGrey.svg" style="vertical-align: text-bottom;">
            </span>
          </div>
          <div>
            {{ t('transactionDialog.status') }}
              <span v-if="historyItem.timestamp === undefined">{{ t('transactionDialog.unconfirmed') }}</span>
              <span v-else>{{ t('transactionDialog.confirmations', { count: store.currentBlockHeight as number - historyItem.blockHeight, block: historyItem.blockHeight.toLocaleString("en-US") }) }}
              </span>
          </div>
          <div v-if="historyItem.timestamp">
            {{ t('transactionDialog.date') }}
              <span>{{ formatReadableDate(historyItem.timestamp) }} ({{ formatRelativeTime(historyItem.timestamp) }})</span>
          </div>
          <div>
            {{ t('transactionDialog.balanceChange') }}
              <span class="balanceChange" :class="historyItem.valueChange < 0 ? 'negative' : 'positive'">
                {{ formatBchAmount(historyItem.valueChange, true, 8) }} {{ bchDisplayUnit }}
              </span>
              <span class="balanceChangeFiat" v-if="store.exchangeRate !== undefined">
                ({{ `${historyItem.valueChange > 0 ? '+' : ''}` + formatFiatAmount(store.exchangeRate * historyItem.valueChange / 100_000_000, settingsStore.currency) }})
              </span>
            <div class="tokenChanges" v-if="historyItem.tokenAmountChanges.length">
              <div class="token-chip" v-for="chip in tokenChangeChips(historyItem, store.bcmrRegistries)" :key="chip.key">
                <TokenIcon
                  :token-id="chip.category"
                  :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(chip.category) : undefined"
                  :size="20"
                />
                <span class="chip-value" :class="chip.negative ? 'negative' : 'positive'">{{ chip.amountText }}</span>
                <span class="chip-symbol">{{ chip.symbol }}</span>
              </div>
            </div>
          </div>
          <label class="noteField">
            <input
              v-model="noteDraft"
              type="text"
              :placeholder="t('transactionDialog.notePlaceholder')"
              :maxlength="maxTxNoteLength"
              autocomplete="off"
              spellcheck="false"
              @blur="saveNote"
              @keyup.enter="saveNote"
            >
            <q-icon name="edit" size="16px" class="noteIcon" />
          </label>
        </div>

        <details class="txDetailsCollapse">
          <summary>{{ t('transactionDialog.fullDetails') }}</summary>

          <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem;">
            <div>
              {{ t('transactionDialog.size') }}
                <span>{{ t('transactionDialog.sizeValue', { bytes: historyItem.size.toLocaleString("en-US") }) }}</span>
            </div>
            <div v-if="!isCoinbase">
              {{ t('transactionDialog.fee') }}
                <span><template v-if="feeIncurrency !== undefined">{{ feeIncurrency }}{{ currencySymbol }} or </template>{{ historyItem.fee.toLocaleString("en-US") }} sat ({{ (historyItem.fee / historyItem.size).toFixed(1) }} sat/byte)</span>
            </div>
            <div v-else>
              {{ t('transactionDialog.feesCollected') }}
                <span><template v-if="feeIncurrency !== undefined">{{ feeIncurrency }}{{ currencySymbol }} or </template>{{ historyItem.fee.toLocaleString("en-US") }} sat</span>
            </div>
          </div>

        <fieldset style="max-height: 200px; overflow: scroll; margin-top: 1rem;">
          <legend style="font-size: medium;">{{ t('transactionDialog.inputs') }}</legend>
          <div v-for="(input, index) in historyItem.inputs" :key="index" class="input" :class="settingsStore.darkMode ? 'dark' : ''">
            <span>{{ index }}: </span>
            <span class="break" :class="store.wallet.hasAddress(input.address) ? 'thisWalletTag' : ''">{{ isCoinbase ? t('transactionDialog.coinbase') : input.address.split(":")[1] }}</span>
            <div style="margin-left: 25px;">
              <div v-if="input.value > 10_000">{{ satsToBch(input.value) }} {{ bchDisplayUnit }}</div>
              <span v-if="input.token" @click="loadTokenMetadata(input.token!.category, input.token?.nft?.commitment)" style="cursor: pointer;">
                <span v-if="input.token.amount > 0n"> {{ " " + formatTokenAmount(input.token.amount, input.token.category) }}</span>
                <span> {{ " " + (store.bcmrRegistries?.[input.token.category]?.token?.symbol ?? input.token.category.slice(0, 8)) }}</span>
                <span v-if="input.token?.nft"> NFT</span>
                <TokenIcon
                  style="margin-left: 0.5rem; vertical-align: sub;"
                  :token-id="input.token.category"
                  :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(input.token.category) : undefined"
                  :size="20"
                />
              </span>
            </div>
          </div>
        </fieldset>

        <fieldset style="max-height: 200px; overflow: scroll; margin-top: 1rem;">
          <legend style="font-size: medium;">{{ t('transactionDialog.outputs') }}</legend>
          <div v-for="(output, index) in historyItem.outputs" :key="index" class="output" :class="settingsStore.darkMode ? 'dark' : ''">
            <span v-if="output.value === 0" class="break">{{ index }}: {{ output.address }}</span>
            <span v-else>{{ index }}: <span class="break" :class="store.wallet.hasAddress(output.address) ? 'thisWalletTag' : ''">{{ output.address.split(":")[1] }}</span></span>
            <div style="margin-left: 25px;">
              <div v-if="output.value > 10_000">{{ satsToBch(output.value) }} {{ bchDisplayUnit }}</div>
              <span v-if="output.token" @click="loadTokenMetadata(output.token!.category, output.token?.nft?.commitment)" style="cursor: pointer;">
                <span v-if="output.token.amount > 0n"> {{ " " + formatTokenAmount(output.token.amount, output.token.category) }}</span>
                <span> {{ " " + (store.bcmrRegistries?.[output.token.category]?.token?.symbol ?? output.token.category.slice(0, 8)) }}</span>
                <span v-if="output.token?.nft"> NFT</span>
                <TokenIcon
                  style="margin-left: 0.5rem; vertical-align: sub;"
                  :token-id="output.token.category"
                  :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(output.token.category) : undefined"
                  :size="20"
                />
              </span>
            </div>
          </div>
        </fieldset>

        </details>

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
  /* the balance change amount uses the same colors and token chips as the history list rows */
  .balanceChange {
    font-family: monospace;
  }
  .balanceChangeFiat {
    opacity: 0.75;
  }
  .tokenChanges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .token-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid rgba(128, 128, 128, 0.25);
    background-color: rgba(128, 128, 128, 0.08);
    border-radius: 14px;
    padding: 2px 10px 2px 4px;
    font-size: 0.85em;
  }
  .chip-value {
    font-family: monospace;
    white-space: nowrap;
  }
  .chip-symbol {
    word-break: break-word;
  }
  .positive {
    color: var(--color-primary);
  }
  .negative {
    color: rgb(188, 30, 30);
  }
  body.dark .negative {
    color: #ef9a9a;
  }
  .txDetailsCollapse {
    margin-top: 1rem;
  }
  .txDetailsCollapse summary {
    display: list-item;
    cursor: pointer;
  }
  .noteField {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid rgba(128, 128, 128, 0.25);
    border-radius: 8px;
    background-color: rgba(128, 128, 128, 0.06);
    transition: border-color 0.2s;
    cursor: text;
  }
  .noteField:focus-within {
    border-color: var(--color-primary);
  }
  .noteIcon {
    flex: none;
    opacity: 0.55;
  }
  .noteField input {
    flex: 1;
    min-width: 0;
    width: auto;
    border: none;
    outline: none;
    box-shadow: none;
    background: transparent;
    padding: 0;
    margin: 0;
    font-size: inherit;
    color: inherit;
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