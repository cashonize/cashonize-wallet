<script setup lang="ts">
  // The UTXO an identity starts from: any at output 0 without a token, whose txid becomes the id.
  // The create page's step 1 and the identities page's add-new share it, so the step's own state
  // lives here: the pick is kept as an outpoint and resolved against the current UTXOs, so one
  // spent from somewhere else leaves the list and takes the selection with it; the step closes to
  // one line once a UTXO is set and reopens on "change". The parent gets the resolved UTXO and
  // whether the step is open, and resets the pick by clearing the UTXO.
  import { computed, ref, watch } from 'vue';
  import type { Utxo } from 'mainnet-js';
  import { copyToClipboard, formatBch, truncateHash } from 'src/utils/utils';
  import { outpointOf } from 'src/utils/wallet/reservedUtxos';
  import { genesisCandidates, preparedUtxoValue } from 'src/utils/tools/tokenCreation';
  import TokenIcon from '../general/TokenIcon.vue';
  import { displayAndLogError } from 'src/utils/errorHandling';
  import { confirmDialog, notifySending } from 'src/utils/txHelpers';
  import { useStore } from 'src/stores/store';
  import { useQuasar } from 'quasar';
  import { useI18n } from 'vue-i18n';

  const props = defineProps<{
    stepLabel: string;
    pickedLabel: string;
    explainer: string;
    prepareMessage: string;
    // an identity keeps the whole UTXO, so the small ones lead
    smallestFirst?: boolean;
  }>();
  const picked = defineModel<Utxo | undefined>({ required: true });
  const open = defineModel<boolean>('open', { required: true });
  const $q = useQuasar();
  const store = useStore();
  const { t } = useI18n();

  const candidates = computed(() => store.spendableUtxos && genesisCandidates(store.spendableUtxos, props.smallestFirst ? 'smallest' : 'largest'));
  const pickedOutpoint = ref<string | undefined>(undefined);
  const pickedUtxo = computed(() => candidates.value?.find(utxo => outpointOf(utxo) === pickedOutpoint.value));
  const editing = ref(true);
  const preparing = ref(false);
  const bchOf = (satoshis: bigint) => formatBch(satoshis, store.network);

  // The parent always holds the current object for the coin, since every utxo refresh hands out
  // fresh ones; the step closes only when the outpoint itself changes, not on those refreshes
  watch(pickedUtxo, utxo => { picked.value = utxo; });
  watch(() => pickedUtxo.value && outpointOf(pickedUtxo.value), outpoint => {
    if (outpoint) editing.value = false;
  });
  watch(() => editing.value || !pickedUtxo.value, isOpen => { open.value = isOpen; }, { immediate: true });
  // the parent clears the UTXO to start the step over
  watch(picked, utxo => {
    if (utxo === undefined && pickedOutpoint.value !== undefined) {
      pickedOutpoint.value = undefined;
      editing.value = true;
    }
  });

  // A self-send makes a fresh UTXO at output 0; the amount stays the user's, only the fee is spent
  async function prepareUtxo() {
    if (preparing.value) return;
    const confirmed = await confirmDialog(
      t('createTokens.prepare.title'),
      props.prepareMessage,
      t('createTokens.genesisInput.prepareButton')
    );
    if (!confirmed) return;
    preparing.value = true;
    try {
      notifySending(t('createTokens.notifications.preparingPreGenesis'));
      const { txId } = await store.spend.send([{ cashaddr: store.wallet.getDepositAddress(), value: preparedUtxoValue }]);
      $q.notify({ type: 'positive', message: t('createTokens.notifications.transactionSent') });
      await store.updateWalletUtxos();
      // the UTXO the user just asked for is the one they meant
      if (txId) pickedOutpoint.value = `${txId}:0`;
      void store.updateWalletHistory();
    } catch (error) {
      displayAndLogError(error);
    } finally {
      preparing.value = false;
    }
  }
</script>

<template>
  <div class="section">
    <template v-if="open">
      <div class="step-label open">{{ stepLabel }}</div>
      <div>{{ explainer }}</div>
      <div v-if="store.spendableBalance === 0n" class="warning-box" style="margin-top: 8px;">
        <q-icon name="warning" size="20px" class="warning-box-icon" />
        <div>{{ t('createTokens.genesisInput.needBch') }}</div>
      </div>

      <input
        @click="prepareUtxo"
        type="button"
        class="primaryButton"
        :value="preparing ? t('createTokens.preparingButton') : t('createTokens.genesisInput.prepareButton')"
        :disabled="preparing || store.spendableBalance === 0n"
        style="margin-top: 10px;"
      >

      <details style="margin-top: 10px;">
        <summary style="display: list-item">{{ t('createTokens.genesisInput.chooseExisting', candidates?.length ?? 0) }}</summary>
        <div class="description" style="margin-top: 4px;">{{ t('createTokens.genesisInput.rule') }}</div>
        <div v-if="candidates === undefined" class="description">{{ t('createTokens.genesisInput.loading') }}</div>
        <template v-else>
          <div v-if="!candidates.length" class="description">{{ t('createTokens.genesisInput.none') }}</div>
          <div v-else class="coin-list">
            <div
              v-for="coin in candidates"
              :key="outpointOf(coin)"
              class="coin-row"
              :class="{ picked: outpointOf(coin) === pickedOutpoint }"
              @click="pickedOutpoint = outpointOf(coin)"
            >
              <TokenIcon :token-id="coin.txid" :size="24" />
              <span class="mono">{{ truncateHash(coin.txid) }}:{{ coin.vout }}</span>
              <span>{{ bchOf(coin.satoshis) }}</span>
              <span v-if="store.addressLabels[coin.address]" class="description">{{ store.addressLabels[coin.address] }}</span>
              <span v-if="!coin.height" class="description">{{ t('createTokens.genesisInput.unconfirmed') }}</span>
            </div>
          </div>
        </template>
      </details>
      <slot />
    </template>
    <div v-else-if="pickedUtxo" class="closed-line description">
      <img src="images/check-circle.svg" class="step-check pop">
      <span>{{ pickedLabel }}</span>
      <span class="copy-target" @click="copyToClipboard(pickedUtxo.txid)">
        <span class="mono">{{ truncateHash(pickedUtxo.txid) }}</span>
        <img class="copyIcon" src="images/copyGrey.svg">
      </span>
      <span>·</span>
      <span class="action-link" @click="editing = true">{{ t('createTokens.change') }}</span>
    </div>
  </div>
</template>

<style scoped>
/* long lists stay a list rather than pushing the form off the screen */
.coin-list {
  max-height: 220px;
  overflow-y: auto;
  margin: 8px 0;
}
.coin-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}
.coin-row:hover {
  border-color: rgba(128, 128, 128, 0.4);
}
.coin-row.picked {
  border-color: var(--color-primary);
}
</style>
