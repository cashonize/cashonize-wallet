<script setup lang="ts">
  // The UTXO an identity starts from: any at output 0 without a token, whose txid becomes the id.
  // The create page's step 1 and the identities page's add-new share it, so the pick is an
  // outpoint the parent resolves against the current UTXOs itself: one spent from somewhere else
  // leaves the list and takes the selection with it. The strings live with the create page,
  // whose step this was first.
  import { computed, ref } from 'vue';
  import { formatBch, truncateHash } from 'src/utils/utils';
  import { outpointOf } from 'src/utils/wallet/reservedUtxos';
  import { genesisCandidates, preparedUtxoValue } from 'src/utils/tools/tokenCreation';
  import TokenIcon from '../general/TokenIcon.vue';
  import { displayAndLogError } from 'src/utils/errorHandling';
  import { confirmDialog, notifySending } from 'src/utils/txHelpers';
  import { useStore } from 'src/stores/store';
  import { useQuasar } from 'quasar';
  import { useI18n } from 'vue-i18n';

  const props = defineProps<{
    modelValue: string | undefined;
    explainer: string;
    prepareMessage: string;
    // an identity keeps the whole UTXO, so the small ones lead
    smallestFirst?: boolean;
  }>();
  const emit = defineEmits<{ (event: 'update:modelValue', outpoint: string | undefined): void }>();
  const $q = useQuasar();
  const store = useStore();
  const { t } = useI18n();

  const candidates = computed(() => store.spendableUtxos && genesisCandidates(store.spendableUtxos, props.smallestFirst ? 'smallest' : 'largest'));
  const preparing = ref(false);
  const bchOf = (satoshis: bigint) => formatBch(satoshis, store.network);

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
      if (txId) emit('update:modelValue', `${txId}:0`);
      void store.updateWalletHistory();
    } catch (error) {
      displayAndLogError(error);
    } finally {
      preparing.value = false;
    }
  }
</script>

<template>
  <div>
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
            :class="{ picked: outpointOf(coin) === modelValue }"
            @click="emit('update:modelValue', outpointOf(coin))"
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
.mono {
  font-family: monospace;
}
</style>
